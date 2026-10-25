using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;

namespace Spiritfire.Game
{
    /// <summary>
    /// 第一人称枪模上的特殊零件（WC3 / WC4）：弩弦与弩箭（<see cref="CrossbowString"/>）、灵炮线圈与蓄力光（<see cref="RailgunCharge"/>）、
    /// 三才转轮的灵纹与弹巢（<see cref="TrinityCycle"/>）、霰铳折开（<see cref="BreakAction"/>）。
    /// 挂在每把枪的 rig（FirstPersonViewmodel 所在物体）上，由 <see cref="WeaponRigParts"/> 按武器 id 自动补挂；
    /// 只读 <see cref="WeaponController"/> 的状态（当前武器、状态机、开火模式），只写枪模根（rig 的子物体）、它的骨骼和自己建的程序化零件，
    /// 不碰 rig 本身的变换（那是 FirstPersonViewmodel 的）。
    /// 坐标：枪模根的局部空间 = Three.js 枪模坐标的 X 取反（<see cref="WeaponDef.Grip"/>），枪口朝 −Z，单位米（rig 的 0.76 缩放由父级带上）。
    /// 骨骼：导出的白模节点 j_N（j_0 = 枪口，其余见各零件）。W3 把它们映射成语义名之后，查找时先找语义名、再退回 j_N。
    /// </summary>
    public abstract class WeaponRigPart : MonoBehaviour
    {
        static readonly int EmissionColorId = Shader.PropertyToID("_EmissionColor");
        static Material lit;
        static MaterialPropertyBlock glowBlock;

        protected WeaponController wc;
        protected string weaponId;
        /// <summary>枪模根（rig 下的枪模 Prefab 实例）；找不到时是 rig 自己</summary>
        protected Transform gun;

        public string WeaponId => weaponId;
        public Transform Gun => gun;

        /// <summary>接到控制器上并建零件（<see cref="WeaponRigParts"/> 调；建零件抛异常时停用自己，不影响开枪）</summary>
        public void Bind(WeaponController controller, string id, Transform gunRoot)
        {
            wc = controller;
            weaponId = id;
            gun = gunRoot ? gunRoot : transform;
            try { Build(); }
            catch (Exception e)
            {
                Debug.LogException(e);
                enabled = false;
            }
        }

        protected abstract void Build();

        /// <summary>手上正在用的是这把 rig 的枪（切枪收枪阶段显示的旧枪不算）</summary>
        protected bool Live
        {
            get
            {
                var a = wc ? wc.Active : null;
                return a != null && a.def != null && a.def.id == weaponId;
            }
        }

        /// <summary>这把 rig 正在显示的枪：手上的；切枪收枪阶段的旧枪；都不是为 null</summary>
        protected WeaponInstance Shown
        {
            get
            {
                if (!wc) return null;
                var a = wc.Active;
                if (a != null && a.def != null && a.def.id == weaponId) return a;
                var h = wc.Holstering;
                return h != null && h.def != null && h.def.id == weaponId ? h : null;
            }
        }

        /// <summary>按名字在枪模下深度查找（先给的名字优先）；都没有为 null</summary>
        protected Transform Bone(params string[] names)
        {
            foreach (var n in names)
            {
                var t = FindDeep(gun, n);
                if (t) return t;
            }
            return null;
        }

        public static Transform FindDeep(Transform root, string name)
        {
            if (!root || string.IsNullOrEmpty(name)) return null;
            if (root.name == name) return root;
            for (int i = 0; i < root.childCount; i++)
            {
                var t = FindDeep(root.GetChild(i), name);
                if (t) return t;
            }
            return null;
        }

        /// <summary>帧率无关的指数逼近（同 TS damp）</summary>
        public static float Damp(float current, float target, float lambda, float dt) =>
            Mathf.Lerp(current, target, 1 - Mathf.Exp(-lambda * Mathf.Max(0, dt)));

        /// <summary>smoothstep（同 TS smooth，输入先钳到 0..1）</summary>
        public static float Smooth(float x)
        {
            x = Mathf.Clamp01(x);
            return x * x * (3 - 2 * x);
        }

        // ───────────── 程序化零件 ─────────────

        /// <summary>受光的固定色件用的默认 Lit 材质（取自内置几何体，打包时一定在；同 ProjectileView）</summary>
        protected static Material Lit
        {
            get
            {
                if (lit) return lit;
                var probe = GameObject.CreatePrimitive(PrimitiveType.Cube);
                probe.SetActive(false);
                lit = probe.GetComponent<Renderer>().sharedMaterial;
                if (Application.isPlaying) Destroy(probe);
                else DestroyImmediate(probe);
                return lit;
            }
        }

        /// <summary>
        /// 建一个程序化零件（网格 + 材质 + 颜色，走属性块不复制材质）：FirstPerson 层、不投影。
        /// 网格用 <see cref="ProjectileMeshes"/>（Box 边长 1、CylZ 沿 Z 长 1、Sphere 半径 1），缩放即尺寸
        /// </summary>
        protected static Renderer Piece(Transform parent, string name, Mesh mesh, Material mat, Color color, Vector3 localPos, Vector3 localScale,
            Quaternion? localRot = null)
        {
            var go = new GameObject(name) { layer = Layers.FirstPerson };
            var t = go.transform;
            t.SetParent(parent, false);
            t.localPosition = localPos;
            t.localRotation = localRot ?? Quaternion.identity;
            t.localScale = localScale;
            go.AddComponent<MeshFilter>().sharedMesh = mesh;
            var r = go.AddComponent<MeshRenderer>();
            r.sharedMaterial = mat;
            r.receiveShadows = false;
            r.reflectionProbeUsage = ReflectionProbeUsage.Off;
            FxMaterials.Tint(r, color);
            return r;
        }

        /// <summary>空节点（零件分组），FirstPerson 层</summary>
        protected static Transform Group(Transform parent, string name, Vector3 localPos)
        {
            var go = new GameObject(name) { layer = Layers.FirstPerson };
            go.transform.SetParent(parent, false);
            go.transform.localPosition = localPos;
            return go.transform;
        }

        // ───────────── 枪身灵纹 ─────────────

        /// <summary>枪模上带自发光的武器渲染器（M_Weapon_* 开了 _EMISSION；手臂、粒子、程序化零件不算），同 <see cref="WeaponTint"/> 的筛选</summary>
        protected static void GlowRenderers(Transform root, List<Renderer> into)
        {
            into.Clear();
            if (!root) return;
            foreach (var r in root.GetComponentsInChildren<Renderer>(true))
                if (WeaponTint.IsWeaponRenderer(r)) into.Add(r);
        }

        /// <summary>给灵纹写 HDR 发光色（属性块，不复制材质；覆盖 <see cref="WeaponTint"/> 的静态着色）</summary>
        protected static void SetGlow(List<Renderer> renderers, Color emission)
        {
            glowBlock ??= new MaterialPropertyBlock();
            emission.a = 1;
            foreach (var r in renderers)
            {
                if (!r) continue;
                r.GetPropertyBlock(glowBlock);
                glowBlock.SetColor(EmissionColorId, emission);
                r.SetPropertyBlock(glowBlock);
            }
        }

        /// <summary>稀有度对应的灵纹亮度（同 <see cref="WeaponTint.Emission"/>：普通 0.5 → 传说 2.0，× 美术基准 1.6）</summary>
        public static float RarityGlow(int rarity) => WeaponTint.Emission(Element.None, rarity).r;
    }

    /// <summary>
    /// 给玩家的每套第一人称 rig 补挂特殊零件（<see cref="WeaponRigPart"/>）：每帧看一眼玩家的 <see cref="WeaponController"/> 与它的 rigs 数组，
    /// 换了玩家（每进一关 <see cref="PlayerFactory"/> 重建）或换了 rigs 就按武器 id 补挂一遍（已经挂着的不重复挂）。不改 WeaponController / PlayerFactory。
    /// 其他单元的零件用 <see cref="Register"/> 登记。
    /// </summary>
    [GameSystem(205)]
    public sealed class WeaponRigParts : MonoBehaviour
    {
        static readonly Dictionary<string, Type> parts = new(StringComparer.Ordinal)
        {
            ["crossbow"] = typeof(CrossbowString),
            ["railgun"] = typeof(RailgunCharge),
            ["trinity"] = typeof(TrinityCycle),
            ["magmashot"] = typeof(BreakAction),
        };

        PlayerVitals boundVitals;
        WeaponController bound;
        WeaponController.Rig[] boundRigs;

        /// <summary>登记一种零件（type 必须继承 <see cref="WeaponRigPart"/>）；同一武器 id 后登记的覆盖先登记的</summary>
        public static void Register(string weaponId, Type part)
        {
            if (string.IsNullOrEmpty(weaponId) || part == null || !typeof(WeaponRigPart).IsAssignableFrom(part) || part.IsAbstract)
                throw new ArgumentException($"零件类型 {part} 不是 WeaponRigPart");
            parts[weaponId] = part;
        }

        /// <summary>这把枪登记的零件类型；没有为 null</summary>
        public static Type PartFor(string weaponId) => weaponId != null && parts.TryGetValue(weaponId, out var t) ? t : null;

        void Update()
        {
            var v = PlayerVitals.Instance;
            if (v != boundVitals)
            {
                boundVitals = v;
                bound = v ? v.GetComponent<WeaponController>() : null;
                boundRigs = null;
            }
            if (!bound || bound.rigs == boundRigs) return;
            boundRigs = bound.rigs;
            Attach(bound);
        }

        /// <summary>给 wc 的每套 rig 补挂登记过的零件；返回新挂的个数</summary>
        public static int Attach(WeaponController wc)
        {
            if (!wc || wc.rigs == null) return 0;
            int n = 0;
            foreach (var rig in wc.rigs)
            {
                if (rig == null || !rig.view) continue;
                var type = PartFor(rig.weaponId);
                if (type == null || rig.view.GetComponent(type)) continue;
                var part = (WeaponRigPart)rig.view.gameObject.AddComponent(type);
                var def = WeaponLibrary.Get(rig.weaponId);
                part.Bind(wc, rig.weaponId, GunOf(rig.view.transform, def?.prefab));
                n++;
            }
            return n;
        }

        /// <summary>rig 下的枪模根：名字等于 Prefab 名的子物体（运行时 GameDatabase.Place 去掉了「(Clone)」），否则第一个子物体</summary>
        public static Transform GunOf(Transform rig, string prefab)
        {
            if (!rig) return null;
            if (!string.IsNullOrEmpty(prefab))
                for (int i = 0; i < rig.childCount; i++)
                {
                    var c = rig.GetChild(i);
                    if (c.name == prefab || c.name.StartsWith(prefab, StringComparison.Ordinal)) return c;
                }
            return rig.childCount > 0 ? rig.GetChild(0) : null;
        }
    }
}
