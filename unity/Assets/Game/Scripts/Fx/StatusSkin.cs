using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;

namespace Spiritfire.Game
{
    /// <summary>
    /// 状态皮（特效打磨 B 路；之前清单里「冰冻冰壳贴身网格」的遗留）：给敌人的身体多画一遍 SF_FxStatusSkin——冰壳 / 蚀斑 / 电纹 / 炭火纹 + 状态色轮廓光。
    /// 单子网格的身体渲染器（Tripo 模型基本都是）：把材质追加到材质表末尾（Unity 用最后一个子网格再画一遍，不用再蒙皮一次）；
    /// 多子网格的：复制一个共用骨骼的渲染器（每个子网格都用这个材质）。只挑带溶解参数的身体材质（SF_StylizedLit），毛发壳层 / 发光壳 / 粒子不管。
    /// 参数写渲染器级 MaterialPropertyBlock（先 Get 再 Set，和 EnemyBody / DeathDissolve 互不覆盖）。
    /// 同时显示的数量受画质限制（<see cref="Cap"/>：高 16 / 中 12 / 低 8），满了只是没有皮（着色和粒子照常）。
    /// 由 <see cref="StatusFx"/> 持有：有状态时 Show，状态全部结束 / 死亡时 Hide。
    /// </summary>
    public sealed class StatusSkin
    {
        static readonly int AmtId = Shader.PropertyToID("_StatusAmt");
        static readonly int MiscId = Shader.PropertyToID("_StatusMisc");
        static readonly int RimId = Shader.PropertyToID("_StatusRim");
        static readonly int DissolveId = Shader.PropertyToID("_DissolveParams");

        static int live;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics() => live = 0;

        /// <summary>同时显示的上限：高 16 / 中 12 / 低 8</summary>
        public static int Cap => Mathf.Max(6, Mathf.RoundToInt(16 * FxBudget.StyleCapScale));

        /// <summary>场上显示中的状态皮数</summary>
        public static int LiveCount => live;

        readonly List<Renderer> appended = new();
        readonly List<GameObject> copies = new();
        readonly List<Renderer> all = new();
        MaterialPropertyBlock block;
        Material mat;

        public bool Showing { get; private set; }

        /// <summary>给 root 下的身体渲染器挂上状态皮；超上限 / 没有材质返回 false</summary>
        public bool Show(GameObject root)
        {
            if (Showing) return true;
            if (!root || live >= Cap) return false;
            mat = FxToon.Material(FxToon.StatusSkin);
            if (!mat || !mat.shader || mat.shader.name != FxToon.ShaderStatusSkin) return false;
            appended.Clear();
            copies.Clear();
            all.Clear();
            foreach (var r in root.GetComponentsInChildren<Renderer>())
            {
                if (r is not (SkinnedMeshRenderer or MeshRenderer) || !r.enabled || r.name.Contains("GlowShell")) continue;
                if (!IsBody(r)) continue;
                Mesh mesh = r is SkinnedMeshRenderer smr ? smr.sharedMesh : r.GetComponent<MeshFilter>() ? r.GetComponent<MeshFilter>().sharedMesh : null;
                if (!mesh) continue;
                if (mesh.subMeshCount <= 1)
                {
                    var mats = r.sharedMaterials;
                    var next = new Material[mats.Length + 1];
                    mats.CopyTo(next, 0);
                    next[mats.Length] = mat;
                    r.sharedMaterials = next;
                    appended.Add(r);
                    all.Add(r);
                }
                else
                {
                    var copy = Copy(r, mesh);
                    if (copy) all.Add(copy);
                }
            }
            if (all.Count == 0) return false;
            Showing = true;
            live++;
            return true;
        }

        static bool IsBody(Renderer r)
        {
            foreach (var m in r.sharedMaterials)
                if (m && m.HasProperty(DissolveId))
                    return true;
            return false;
        }

        Renderer Copy(Renderer r, Mesh mesh)
        {
            var go = new GameObject(r.name + " StatusSkin") { layer = r.gameObject.layer };
            var mats = new Material[mesh.subMeshCount];
            for (int i = 0; i < mats.Length; i++) mats[i] = mat;
            Renderer c;
            if (r is SkinnedMeshRenderer smr)
            {
                go.transform.SetParent(smr.transform.parent, false);
                go.transform.localPosition = smr.transform.localPosition;
                go.transform.localRotation = smr.transform.localRotation;
                go.transform.localScale = smr.transform.localScale;
                var s = go.AddComponent<SkinnedMeshRenderer>();
                s.sharedMesh = mesh;
                s.bones = smr.bones;
                s.rootBone = smr.rootBone;
                s.localBounds = smr.localBounds;
                s.quality = smr.quality;
                s.updateWhenOffscreen = smr.updateWhenOffscreen;
                c = s;
            }
            else
            {
                go.transform.SetParent(r.transform, false);
                go.AddComponent<MeshFilter>().sharedMesh = mesh;
                c = go.AddComponent<MeshRenderer>();
            }
            c.sharedMaterials = mats;
            c.shadowCastingMode = ShadowCastingMode.Off;
            c.receiveShadows = false;
            c.lightProbeUsage = LightProbeUsage.Off;
            c.reflectionProbeUsage = ReflectionProbeUsage.Off;
            copies.Add(go);
            return c;
        }

        /// <summary>摘掉状态皮（只去掉自己追加的那一个材质：别人这期间换了材质表也不会被改回去）</summary>
        public void Hide()
        {
            if (!Showing) return;
            Showing = false;
            live = Mathf.Max(0, live - 1);
            foreach (var r in appended)
            {
                if (!r) continue;
                var mats = r.sharedMaterials;
                int k = System.Array.LastIndexOf(mats, mat);
                if (k < 0) continue;
                var next = new Material[mats.Length - 1];
                for (int i = 0, w = 0; i < mats.Length; i++)
                    if (i != k)
                        next[w++] = mats[i];
                r.sharedMaterials = next;
            }
            foreach (var go in copies)
                if (go)
                    Object.Destroy(go);
            appended.Clear();
            copies.Clear();
            all.Clear();
        }

        /// <summary>写参数：amount = (冰, 蚀, 雷, 火)，misc = (眩晕, 种子, 地面高度, 1 / 身高)，rim = 轮廓光（rgb HDR，a 强度）</summary>
        public void Write(Vector4 amount, Vector4 misc, Color rim)
        {
            if (!Showing) return;
            block ??= new MaterialPropertyBlock();
            foreach (var r in all)
            {
                if (!r) continue;
                r.GetPropertyBlock(block);
                block.SetVector(AmtId, amount);
                block.SetVector(MiscId, misc);
                block.SetVector(RimId, new Vector4(rim.r, rim.g, rim.b, rim.a));
                r.SetPropertyBlock(block);
            }
        }
    }
}
