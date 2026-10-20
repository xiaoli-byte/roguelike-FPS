using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using Spiritfire.Game;
using UnityEditor;
using UnityEngine;
using Debug = UnityEngine.Debug;
using Object = UnityEngine.Object;

namespace Spiritfire.Art.Editor
{
    /// <summary>
    /// 碎刃烘焙（WC5，bridge.sh blade / 菜单 Spiritfire ▸ Weapons ▸ Bake Demon Blade）。碎刃是程序化几何，美术管线导不了，这里用运行时同一份
    /// <see cref="BladeShape"/> / <see cref="BladeMeshes"/> 生成资产：
    ///   1. 网格 → Assets/Art/Weapons/SK_Weapon_DemonBlade/Meshes/SM_DemonBlade_{Shards,Root,Hilt}.asset（128 片蒙皮碎刃、刀根鬼面厚板、刀柄）；
    ///   2. 渐变贴图 → …/Ramps/T_DemonBlade_ShardRamp_{D,E}.png（不放 Textures/：那里的贴图会被 ArtImportPostprocessor 改成压缩 + mip）；
    ///   3. 刀柄贴图集 → …/Textures/T_DemonBlade_Hilt_{D,E}.png：从 Three.js 版发布的 public/assets/weapons/T_DemonBlade_Hilt_*.webp 转码
    ///      （Unity 不认 webp，调本机 python + Pillow；没有就退回程序色并报错），源头是 art/pipeline/demon_blade_textures.py 从设计图裁的；
    ///   4. 材质 → …/M_DemonBlade_{Shard,Hilt}.mat（Spiritfire/StylizedLit）；
    ///   5. Prefab → Assets/Art/Prefabs/Weapons/SK_Weapon_DemonBlade.prefab（<see cref="BladeModel"/>；GameDatabase 按武器表的 prefab 名收录，
    ///      掉落物、第一人称 rig 都用它）。烘完要再跑一次 bridge.sh core 让 GameDatabase 收进来。
    /// 幂等：已有资产原地覆盖内容（GUID 不变），贴图内容没变就不重写。返回错误数。
    /// </summary>
    public static class BladeMeshBaker
    {
        public const string Dir = "Assets/Art/Weapons/SK_Weapon_DemonBlade";
        public const string MeshDir = Dir + "/Meshes";
        public const string RampDir = Dir + "/Ramps";
        public const string TextureDir = Dir + "/Textures";
        public const string PrefabPath = "Assets/Art/Prefabs/Weapons/" + BladeModel.PrefabId + ".prefab";
        /// <summary>Three.js 版发布的刀柄贴图（相对仓库根）</summary>
        const string WebpDir = "public/assets/weapons";

        [MenuItem("Spiritfire/Weapons/Bake Demon Blade（碎刃网格 + 贴图 + Prefab）", priority = 120)]
        static void Menu()
        {
            int errors = Bake();
            EditorUtility.DisplayDialog("碎刃烘焙", errors == 0 ? "碎刃资产已生成（再跑一次 Build Core Scene 让 GameDatabase 收录）" : $"完成，但有 {errors} 个问题（见 Console）", "好");
        }

        /// <summary>生成全部碎刃资产；返回错误数</summary>
        public static int Bake()
        {
            int errors = 0;
            var log = new List<string>();
            Folder(MeshDir);
            Folder(RampDir);
            Folder(TextureDir);
            Folder(Path.GetDirectoryName(PrefabPath)!.Replace('\\', '/'));

            // 1. 网格
            var shards = SaveMesh(BladeMeshes.BuildShards(), $"{MeshDir}/SM_DemonBlade_Shards.asset");
            var root = SaveMesh(BladeMeshes.BuildRoot(), $"{MeshDir}/SM_DemonBlade_Root.asset");
            var hilt = SaveMesh(BladeMeshes.BuildHilt(), $"{MeshDir}/SM_DemonBlade_Hilt.asset");
            log.Add($"网格：碎片 {shards.vertexCount} 顶点 / {shards.bindposes.Length} 骨骼，刀根 {root.vertexCount}，刀柄 {hilt.vertexCount}");

            // 2. 渐变贴图
            BladeMeshes.BuildRamps(out var rampD, out var rampE);
            var rd = SavePng(rampD, $"{RampDir}/{rampD.name}.png", ConfigureRamp);
            var re = SavePng(rampE, $"{RampDir}/{rampE.name}.png", ConfigureRamp);
            Object.DestroyImmediate(rampD);
            Object.DestroyImmediate(rampE);

            // 3. 刀柄贴图集（webp → png）
            var hd = ConvertHilt("T_DemonBlade_Hilt_D", log, ref errors);
            var he = ConvertHilt("T_DemonBlade_Hilt_E", log, ref errors);
            if (!hd || !he)
            {
                BladeMeshes.BuildFallbackHilt(out var fd, out var fe);
                hd = hd ? hd : SavePng(fd, $"{TextureDir}/T_DemonBlade_Hilt_D.png", null);
                he = he ? he : SavePng(fe, $"{TextureDir}/T_DemonBlade_Hilt_E.png", null);
                Object.DestroyImmediate(fd);
                Object.DestroyImmediate(fe);
                log.Add("刀柄贴图用了程序兜底色（装好 Pillow 后重跑 bridge.sh blade 换成设计图贴图）");
            }

            // 4. 材质
            var shader = Shader.Find(BladeMeshes.ShaderName);
            if (!shader)
            {
                Debug.LogError($"[Blade] 找不到着色器 {BladeMeshes.ShaderName}");
                return errors + 1;
            }
            var shardMat = SaveMaterial($"{Dir}/M_DemonBlade_Shard.mat", shader, m => BladeMeshes.SetupShardMaterial(m, rd, re));
            var hiltMat = SaveMaterial($"{Dir}/M_DemonBlade_Hilt.mat", shader, m => BladeMeshes.SetupHiltMaterial(m, hd, he));

            // 5. Prefab
            var model = BladeModel.Assemble(null, shards, root, hilt, shardMat, hiltMat);
            try
            {
                PrefabUtility.SaveAsPrefabAsset(model.gameObject, PrefabPath, out bool ok);
                if (!ok)
                {
                    errors++;
                    Debug.LogError($"[Blade] 保存 Prefab 失败：{PrefabPath}");
                }
                else log.Add($"Prefab → {PrefabPath}");
            }
            finally
            {
                Object.DestroyImmediate(model.gameObject);
            }
            AssetDatabase.SaveAssets();
            foreach (var l in log) Debug.Log("[Blade] " + l);
            Debug.Log(errors == 0 ? "[Blade] 完成（再跑 bridge.sh core 让 GameDatabase 收录 SK_Weapon_DemonBlade）" : $"[Blade] 完成，有 {errors} 个问题");
            return errors;
        }

        static void Folder(string path)
        {
            if (AssetDatabase.IsValidFolder(path)) return;
            string parent = Path.GetDirectoryName(path)!.Replace('\\', '/');
            Folder(parent);
            AssetDatabase.CreateFolder(parent, Path.GetFileName(path));
        }

        /// <summary>存网格：已有资产就原地覆盖（GUID 不变，引用它的 Prefab 不断）</summary>
        static Mesh SaveMesh(Mesh mesh, string path)
        {
            mesh.name = Path.GetFileNameWithoutExtension(path);
            var existing = AssetDatabase.LoadAssetAtPath<Mesh>(path);
            if (existing)
            {
                existing.Clear();
                EditorUtility.CopySerialized(mesh, existing);
                existing.name = mesh.name;
                Object.DestroyImmediate(mesh);
                EditorUtility.SetDirty(existing);
                return existing;
            }
            AssetDatabase.CreateAsset(mesh, path);
            return mesh;
        }

        /// <summary>存 PNG：内容没变就不写（不碰时间戳）；configure 返回 true 时重新导入</summary>
        static Texture2D SavePng(Texture2D tex, string path, Func<TextureImporter, bool> configure)
        {
            byte[] png = tex.EncodeToPNG();
            if (!File.Exists(path) || !File.ReadAllBytes(path).SequenceEqual(png))
            {
                File.WriteAllBytes(path, png);
                AssetDatabase.ImportAsset(path, ImportAssetOptions.ForceSynchronousImport);
            }
            if (configure != null && AssetImporter.GetAtPath(path) is TextureImporter ti && configure(ti)) ti.SaveAndReimport();
            return AssetDatabase.LoadAssetAtPath<Texture2D>(path);
        }

        /// <summary>渐变贴图：sRGB、不要 mip、钳边、双线性、不压缩（4 套抖动并排，压缩 / mip 会串色）</summary>
        static bool ConfigureRamp(TextureImporter ti)
        {
            bool changed = false;
            void Set<T>(T current, T want, Action<T> apply)
            {
                if (EqualityComparer<T>.Default.Equals(current, want)) return;
                apply(want);
                changed = true;
            }
            Set(ti.textureType, TextureImporterType.Default, v => ti.textureType = v);
            Set(ti.sRGBTexture, true, v => ti.sRGBTexture = v);
            Set(ti.mipmapEnabled, false, v => ti.mipmapEnabled = v);
            Set(ti.wrapMode, TextureWrapMode.Clamp, v => ti.wrapMode = v);
            Set(ti.filterMode, FilterMode.Bilinear, v => ti.filterMode = v);
            Set(ti.textureCompression, TextureImporterCompression.Uncompressed, v => ti.textureCompression = v);
            Set(ti.npotScale, TextureImporterNPOTScale.None, v => ti.npotScale = v);
            Set(ti.alphaSource, TextureImporterAlphaSource.None, v => ti.alphaSource = v);
            return changed;
        }

        /// <summary>
        /// webp → png：Unity 不导入 webp，调本机 python（Pillow）转码到 Textures/（导入设置由 ArtImportPostprocessor 统一：sRGB、mip、压缩）。
        /// 源文件缺失或转码失败返回 null（计一个错误）
        /// </summary>
        static Texture2D ConvertHilt(string name, List<string> log, ref int errors)
        {
            string repo = Path.GetFullPath(Path.Combine(Application.dataPath, "..", ".."));
            string src = Path.Combine(repo, WebpDir, name + ".webp");
            string dst = $"{TextureDir}/{name}.png";
            if (!File.Exists(src))
            {
                errors++;
                Debug.LogError($"[Blade] 没有 {src}（先跑 python art/pipeline/demon_blade_textures.py）");
                return null;
            }
            string full = Path.GetFullPath(dst);
            // 转码到临时文件再比对：内容没变就不动资产
            string tmp = Path.Combine(Path.GetTempPath(), $"sf_blade_{name}_{Guid.NewGuid():N}.png");
            try
            {
                string err = null;
                bool ok = false;
                foreach (var exe in new[] { "python", "py", "python3" })
                    if (RunPython(exe, src, tmp, out err))
                    {
                        ok = true;
                        break;
                    }
                if (!ok || !File.Exists(tmp))
                {
                    errors++;
                    Debug.LogError($"[Blade] 刀柄贴图转码失败（需要 python + Pillow）：{err}");
                    return null;
                }
                byte[] png = File.ReadAllBytes(tmp);
                if (!File.Exists(full) || !File.ReadAllBytes(full).SequenceEqual(png))
                {
                    File.WriteAllBytes(full, png);
                    AssetDatabase.ImportAsset(dst, ImportAssetOptions.ForceSynchronousImport);
                }
                log.Add($"刀柄贴图 {name}.webp → {dst}");
                return AssetDatabase.LoadAssetAtPath<Texture2D>(dst);
            }
            finally
            {
                try { if (File.Exists(tmp)) File.Delete(tmp); }
                catch { /* 临时文件删不掉不影响结果 */ }
            }
        }

        static bool RunPython(string exe, string src, string dst, out string error)
        {
            error = null;
            try
            {
                const string code = "import sys; from PIL import Image; Image.open(sys.argv[1]).convert('RGB').save(sys.argv[2], 'PNG')";
                var psi = new ProcessStartInfo(exe, $"-c \"{code}\" \"{src}\" \"{dst}\"")
                {
                    UseShellExecute = false, CreateNoWindow = true, RedirectStandardError = true, RedirectStandardOutput = true,
                };
                using var p = Process.Start(psi);
                if (p == null)
                {
                    error = $"{exe} 启动失败";
                    return false;
                }
                string stderr = p.StandardError.ReadToEnd();
                if (!p.WaitForExit(60000))
                {
                    try { p.Kill(); }
                    catch { /* 已退出 */ }
                    error = $"{exe} 超时";
                    return false;
                }
                if (p.ExitCode != 0)
                {
                    error = $"{exe}：{stderr.Trim()}";
                    return false;
                }
                return true;
            }
            catch (Exception e)
            {
                error = $"{exe}：{e.Message}";
                return false;
            }
        }

        /// <summary>存材质：已有就改属性（GUID 不变）</summary>
        static Material SaveMaterial(string path, Shader shader, Action<Material> setup)
        {
            var m = AssetDatabase.LoadAssetAtPath<Material>(path);
            bool created = !m;
            if (created) m = new Material(shader);
            else if (m.shader != shader) m.shader = shader;
            m.name = Path.GetFileNameWithoutExtension(path);
            setup(m);
            if (created) AssetDatabase.CreateAsset(m, path);
            else EditorUtility.SetDirty(m);
            return m;
        }
    }
}
