using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using Spiritfire.Game;
using UnityEditor;
using UnityEngine;
using UnityEngine.Audio;
using Object = UnityEngine.Object;

namespace Spiritfire.Art.Editor
{
    /// <summary>
    /// 生成混音台 Resources/Audio/Spiritfire.mixer（F5；bash scripts/unity/bridge.sh audio [force]，或菜单 Spiritfire/Audio/Build Mixer）。
    /// 结构见 <see cref="AudioMix"/>：Master（限幅）→ World（压低快照 + 低通）→ SFX / Music / Ambience / Reverb，UI 直接挂 Master；
    /// 快照 Gameplay / Paused（World 0.45 + 6 kHz 低通）/ Summary（0.8）；暴露参数 = 各总线的玩家音量 + WorldVolume（只读核对）+ ReverbSend。
    /// Unity 没有公开的建 Mixer 接口，这里用编辑器自己的 AudioMixerController（反射，和 Audio Mixer 窗口走同一套代码，GUID / 参数都由它分配）。
    /// 已有文件时只做检查（不重建，免得每次都换一套内部 GUID）；参数 force：删掉重建。返回问题数（bridge 回应 qa-errors）。
    /// </summary>
    public static class AudioMixerBuilder
    {
        public const string MixerPath = "Assets/Game/Resources/" + AudioMix.ResourcePath + ".mixer";

        const BindingFlags AnyMember = BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance | BindingFlags.Static;

        [MenuItem("Spiritfire/Audio/Build Mixer", priority = 95)]
        static void Menu()
        {
            int n = Build(true);
            EditorUtility.DisplayDialog("Audio Mixer", n == 0 ? "混音台已生成，检查全部通过" : $"混音台已生成，有 {n} 个问题，见 Console", "OK");
        }

        /// <summary>生成（缺文件或 force 时）并检查</summary>
        public static int Build(bool force = false)
        {
            int errors = 0;
            if (force && File.Exists(MixerPath)) AssetDatabase.DeleteAsset(MixerPath);
            if (!File.Exists(MixerPath))
            {
                try { errors += Create(); }
                catch (Exception e)
                {
                    Debug.LogError($"[AudioMixer] 生成失败：{e}");
                    return errors + 1;
                }
            }
            errors += Validate();
            Debug.Log(errors == 0 ? $"[AudioMixer] {MixerPath} 检查通过" : $"[AudioMixer] {MixerPath} 有 {errors} 个问题");
            return errors;
        }

        // ───────────── 反射小工具 ─────────────

        static Type T(string name) =>
            AppDomain.CurrentDomain.GetAssemblies().Select(a => a.GetType("UnityEditor.Audio." + name)).FirstOrDefault(t => t != null)
            ?? throw new MissingMemberException($"找不到 UnityEditor.Audio.{name}（Unity 版本变了？）");

        static object Call(object target, string name, params object[] args)
        {
            var type = target as Type ?? target.GetType();
            var inst = target is Type ? null : target;
            for (var t = type; t != null; t = t.BaseType)
            {
                var m = t.GetMethods(AnyMember).FirstOrDefault(x => x.Name == name && x.GetParameters().Length == args.Length);
                if (m != null) return m.Invoke(inst, args);
            }
            throw new MissingMethodException(type.FullName, name);
        }

        static object Get(object target, string prop)
        {
            for (var t = target.GetType(); t != null; t = t.BaseType)
                if (t.GetProperty(prop, AnyMember) is { } p) return p.GetValue(target);
            throw new MissingMemberException(target.GetType().FullName, prop);
        }

        static void Set(object target, string prop, object value)
        {
            for (var t = target.GetType(); t != null; t = t.BaseType)
                if (t.GetProperty(prop, AnyMember) is { } p)
                {
                    p.SetValue(target, value);
                    return;
                }
            throw new MissingMemberException(target.GetType().FullName, prop);
        }

        static object New(string type, params object[] args) => Activator.CreateInstance(T(type), AnyMember, null, args, null);

        /// <summary>某种效果器的参数名（编辑器的效果定义表）</summary>
        static string[] EffectParams(string effect)
        {
            var defs = (Array)Call(T("MixerEffectDefinitions"), "GetEffectParameters", effect);
            if (defs == null) return Array.Empty<string>();
            var names = new List<string>();
            foreach (var d in defs) names.Add((string)d.GetType().GetField("name", AnyMember).GetValue(d));
            return names.ToArray();
        }

        // ───────────── 生成 ─────────────

        sealed class Ctx
        {
            public AudioMixer controller;
            public int errors;
        }

        static int Create()
        {
            Directory.CreateDirectory(Path.GetDirectoryName(MixerPath)!);
            var ctx = new Ctx();
            var controller = (AudioMixer)Call(T("AudioMixerController"), "CreateMixerControllerAtPath", MixerPath);
            ctx.controller = controller;
            var master = (AudioMixerGroup)Get(controller, "masterGroup");
            var gameplay = (AudioMixerSnapshot)((Array)Get(controller, "snapshots")).GetValue(0);
            gameplay.name = AudioMix.SnapshotGameplay;

            AudioMixerGroup Group(string name, AudioMixerGroup parent)
            {
                var g = (AudioMixerGroup)Call(controller, "CreateNewGroup", name, false);
                Call(controller, "AddChildToParent", g, parent);
                return g;
            }

            var world = Group("World", master);
            var sfx = Group("SFX", world);
            var music = Group("Music", world);
            var ambience = Group("Ambience", world);
            var reverb = Group("Reverb", world);
            var ui = Group("UI", master);
            SetView(controller, master, world, sfx, music, ambience, reverb, ui);

            Object Effect(AudioMixerGroup g, string effect, int index)
            {
                if (!(bool)Call(T("MixerEffectDefinitions"), "EffectExists", effect))
                    throw new ArgumentException($"没有效果器「{effect}」，可用：{string.Join("、", (string[])Call(T("MixerEffectDefinitions"), "GetEffectList"))}");
                var fx = (Object)New("AudioMixerEffectController", effect);
                Call(controller, "AddNewSubAsset", fx, false);
                Call(fx, "PreallocateGUIDs");
                Call(g, "InsertEffect", fx, index);
                return fx;
            }

            // 组里第 0 个是衰减（推子）；效果器插在它后面 = 推子后
            var limiter = Effect(master, "Compressor", 1);
            var lowpass = Effect(world, "Lowpass Simple", 1);
            var receive = Effect(reverb, "Receive", 0);
            var room = Effect(reverb, "SFX Reverb", 1);
            var send = Effect(sfx, "Send", 1);
            Set(send, "sendTarget", receive);

            // ── 游玩快照（其余快照从它克隆）──
            Vol(ctx, master, gameplay, 0);
            Vol(ctx, world, gameplay, 0);
            foreach (var g in new[] { sfx, music, ambience, reverb, ui }) Vol(ctx, g, gameplay, 0);
            Param(ctx, limiter, "Compressor", gameplay, "Threshold", AudioMix.LimiterThreshold);
            Param(ctx, limiter, "Compressor", gameplay, "Attack", AudioMix.LimiterAttack);
            Param(ctx, limiter, "Compressor", gameplay, "Release", AudioMix.LimiterRelease);
            Param(ctx, lowpass, "Lowpass Simple", gameplay, "Cutoff freq", AudioMix.OpenLowpass);
            // 混响返回：纯湿声的「通用」房间（EAX Generic 一类的值，mB / 秒）；发送默认 −80 dB = 关（混响已烘进片段，留给 I6 混响区）
            Param(ctx, room, "SFX Reverb", gameplay, "Dry Level", -10000);
            Param(ctx, room, "SFX Reverb", gameplay, "Room", -1000);
            Param(ctx, room, "SFX Reverb", gameplay, "Room HF", -100);
            Param(ctx, room, "SFX Reverb", gameplay, "Decay Time", 1.49f);
            Param(ctx, room, "SFX Reverb", gameplay, "Reflections", -2602);
            Param(ctx, room, "SFX Reverb", gameplay, "Reverb", 200);
            Call(send, "SetValueForMixLevel", controller, gameplay, -80f);

            AudioMixerSnapshot Clone(string name)
            {
                Set(controller, "TargetSnapshot", gameplay);
                Call(controller, "CloneNewSnapshotFromTarget", false);
                var all = (Array)Get(controller, "snapshots");
                var s = (AudioMixerSnapshot)all.GetValue(all.Length - 1);
                s.name = name;
                return s;
            }

            var paused = Clone(AudioMix.SnapshotPaused);
            Vol(ctx, world, paused, AudioMix.LinearToDb(AudioDuck.PausedDuck));
            Param(ctx, lowpass, "Lowpass Simple", paused, "Cutoff freq", AudioMix.PausedLowpass);
            var summary = Clone(AudioMix.SnapshotSummary);
            Vol(ctx, world, summary, AudioMix.LinearToDb(AudioDuck.SummaryDuck));
            Set(controller, "TargetSnapshot", gameplay);
            Set(controller, "startSnapshot", gameplay);

            // ── 暴露参数 ──
            void ExposeVolume(AudioMixerGroup g, string name) =>
                Expose(controller, New("AudioGroupParameterPath", g, Call(g, "GetGUIDForVolume")), name);
            ExposeVolume(master, AudioMix.ParamMaster);
            ExposeVolume(sfx, AudioMix.ParamSfx);
            ExposeVolume(music, AudioMix.ParamMusic);
            ExposeVolume(ui, AudioMix.ParamUi);
            ExposeVolume(ambience, AudioMix.ParamAmbience);
            ExposeVolume(world, AudioMix.ParamWorld);
            Expose(controller, New("AudioEffectParameterPath", sfx, send, Call(send, "GetGUIDForMixLevel")), AudioMix.ParamReverbSend);

            controller.updateMode = AudioMixerUpdateMode.UnscaledTime;
            EditorUtility.SetDirty(controller);
            AssetDatabase.SaveAssets();
            AssetDatabase.ImportAsset(MixerPath, ImportAssetOptions.ForceUpdate);
            return ctx.errors;
        }

        /// <summary>Audio Mixer 窗口的组视图（新建的混音台没有视图，组在窗口里不显示）：一个包含全部组的「View」。只影响编辑器显示，失败不算错</summary>
        static void SetView(AudioMixer controller, params AudioMixerGroup[] groups)
        {
            try
            {
                var viewType = T("MixerGroupView");
                var guidType = typeof(GUID);
                var guids = Array.CreateInstance(guidType, groups.Length);
                for (int i = 0; i < groups.Length; i++) guids.SetValue(Get(groups[i], "groupID"), i);
                object view = Activator.CreateInstance(viewType);
                viewType.GetField("guids", AnyMember)!.SetValue(view, guids);
                viewType.GetField("name", AnyMember)!.SetValue(view, "View");
                var views = Array.CreateInstance(viewType, 1);
                views.SetValue(view, 0);
                Set(controller, "views", views);
                Set(controller, "currentViewIndex", 0);
            }
            catch (Exception e)
            {
                Debug.LogWarning($"[AudioMixer] 窗口视图没设上（只影响 Audio Mixer 窗口显示）：{e.InnerException?.Message ?? e.Message}");
            }
        }

        static void Vol(Ctx ctx, AudioMixerGroup g, AudioMixerSnapshot s, float db)
        {
            Call(g, "SetValueForVolume", ctx.controller, s, db);
            float back = (float)Call(g, "GetValueForVolume", ctx.controller, s);
            if (Mathf.Abs(back - db) > 0.01f)
            {
                Debug.LogError($"[AudioMixer] {g.name} 在快照 {s.name} 的音量写 {db:0.##} dB，读回 {back:0.##}");
                ctx.errors++;
            }
        }

        static void Param(Ctx ctx, Object fx, string effect, AudioMixerSnapshot s, string param, float value)
        {
            var names = EffectParams(effect);
            if (!names.Contains(param))
            {
                Debug.LogError($"[AudioMixer] 效果器 {effect} 没有参数「{param}」，可用：{string.Join("、", names)}");
                ctx.errors++;
                return;
            }
            Call(fx, "SetValueForParameter", ctx.controller, s, param, value);
            float back = (float)Call(fx, "GetValueForParameter", ctx.controller, s, param);
            if (Mathf.Abs(back - value) > Mathf.Max(0.01f, Mathf.Abs(value) * 1e-3f))
            {
                Debug.LogError($"[AudioMixer] {effect}.{param} 在快照 {s.name} 写 {value}，读回 {back}（超出范围被夹？）");
                ctx.errors++;
            }
        }

        static void Expose(AudioMixer controller, object path, string name)
        {
            Call(controller, "AddExposedParameter", path);
            var guid = path.GetType().GetField("parameter", AnyMember)!.GetValue(path);
            var arr = (Array)Get(controller, "exposedParameters");
            var guidField = arr.GetType().GetElementType()!.GetField("guid", AnyMember)!;
            var nameField = arr.GetType().GetElementType()!.GetField("name", AnyMember)!;
            for (int i = 0; i < arr.Length; i++)
            {
                var e = arr.GetValue(i);
                if (!guidField.GetValue(e).Equals(guid)) continue;
                nameField.SetValue(e, name);
                arr.SetValue(e, i);
            }
            Set(controller, "exposedParameters", arr);
            Call(controller, "OnChangedExposedParameter");
        }

        // ───────────── 检查 ─────────────

        /// <summary>组、快照、暴露参数、更新模式、快照里 World 的电平都对得上</summary>
        public static int Validate()
        {
            int errors = 0;
            void Err(string msg)
            {
                Debug.LogError($"[AudioMixer] {msg}");
                errors++;
            }

            var mixer = AssetDatabase.LoadAssetAtPath<AudioMixer>(MixerPath);
            if (!mixer)
            {
                Err($"{MixerPath} 载入不了");
                return errors;
            }
            foreach (var path in AudioMix.GroupPaths)
                if (!AudioMix.Find(mixer, path)) Err($"缺组 {path}");
            foreach (var s in AudioMix.Snapshots)
                if (!mixer.FindSnapshot(s)) Err($"缺快照 {s}");
            if (mixer.updateMode != AudioMixerUpdateMode.UnscaledTime) Err("更新模式不是不缩放时间（暂停时快照不会过渡）");
            try
            {
                var exposed = new HashSet<string>();
                foreach (var e in (Array)Get(mixer, "exposedParameters"))
                    exposed.Add((string)e.GetType().GetField("name", AnyMember)!.GetValue(e));
                foreach (var p in AudioMix.ExposedParams)
                    if (!exposed.Contains(p)) Err($"缺暴露参数 {p}");

                var world = AudioMix.Find(mixer, AudioMix.PathWorld);
                if (world)
                {
                    (string snap, float duck)[] expect =
                    {
                        (AudioMix.SnapshotGameplay, 1f), (AudioMix.SnapshotPaused, AudioDuck.PausedDuck), (AudioMix.SnapshotSummary, AudioDuck.SummaryDuck),
                    };
                    foreach (var (snap, duck) in expect)
                    {
                        var s = mixer.FindSnapshot(snap);
                        if (!s) continue;
                        float db = (float)Call(world, "GetValueForVolume", mixer, s);
                        if (Mathf.Abs(db - AudioMix.LinearToDb(duck)) > 0.05f) Err($"快照 {snap} 的 World = {db:0.##} dB，应为 {AudioMix.LinearToDb(duck):0.##} dB（{duck}）");
                    }
                }
                var master = AudioMix.Find(mixer, AudioMix.PathMaster);
                if (master)
                {
                    var effects = (Array)Get(master, "effects");
                    bool limiter = false;
                    foreach (var fx in effects)
                        if ((string)Get(fx, "effectName") == "Compressor") limiter = true;
                    if (!limiter) Err("Master 上没有限幅器（Compressor）");
                }
            }
            catch (Exception e)
            {
                Err($"反射检查失败：{e.Message}");
            }
            return errors;
        }
    }
}
