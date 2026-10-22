using System;
using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>吊鼎的状态：吊着 / 一角坠下（还挂着别的链）/ 整口坠池中 / 坠池落定（池中掩体）</summary>
    public enum CauldronState { Hang, Corner, Falling, Fallen }

    /// <summary>
    /// 祝融炉心殿的吊鼎与四条巨链（Three.js QilinCauldron；3-4，docs/level-design/maps/3-4.md）：首领战的场景件，关卡构建器摆在熔池圆心
    /// （物体位置 = 熔池圆心、殿内地面高度），四个锁扣（<see cref="QilinLock"/>）按象限顺序挂在 <see cref="locks"/> 上。
    ///   一口 8 m 高的青铜方鼎吊在熔池上方（鼎身中心离地 <see cref="hangHeight"/>），四个上角各拴一条巨链，链从角上的铁环斜着拉到外墙高处的锁扣——
    ///   锁扣在鼎角上方，四条链把鼎兜在半空（Three.js 是锁扣在 3–4 m、链从上往下拉，鼎悬空没有着力点；这里改成链从高处吊住鼎，打断一条，那一角就真的坠下去）。
    ///   鼎的四个角正对四个象限中线（锁扣方向）。三种状态：
    ///   吊着（<see cref="CauldronState.Hang"/>）：轻轻摆；
    ///   一角坠下（<see cref="DropCorner"/>）：那条链崩飞，鼎朝那一角倾倒、角足斜砸在池沿上（离圆心 熔池 + <see cref="impactOut"/> 米），
    ///     砸下的那一刻派发 <see cref="Impact"/>（fallen = false）。之后再断一角，鼎改朝新的一角倾倒；
    ///   坠池（<see cref="Fall"/>，55%）：剩下的链全断，鼎整个砸进熔池、翻倒半露，落定时派发 <see cref="Impact"/>（fallen = true）并立一个碰撞盒——
    ///     二阶段它是池中挡吐息、挡视线的掩体（盒子在熔池里，不影响导航）。
    /// 外观：物体下有名为 Model 的子物体（正式美术 SM_Prop_QilinCauldron，ART6 暂缓）就用它，否则运行时搭程序方鼎（鼎身、口沿、腰箍、饕餮纹、双耳、四足、鼎口熔岩、四角铁环）；
    ///   有 Model (fallen) 子物体时坠池落定换成它（关卡可以摆一个翻倒的残鼎）。
    ///   巨链：<see cref="linkTemplate"/>（关卡摆进来、停用的 SM_Prop_InfernoChainLink：长 1 m、节距 0.68 m、每隔一节绕 Y 转 90°）运行时按链长实例化；
    ///   没有模板时用程序方块链环。
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class QilinCauldron : MonoBehaviour
    {
        /// <summary>鼎身半宽、半高；足长；足在鼎身局部往里收多少（TS QilinCauldron 的 HALF / HALF_Y / LEG / LEG_IN）</summary>
        public const float Half = 2.6f, HalfY = 1.8f, Leg = 2.4f, LegIn = Half - 0.45f;
        /// <summary>一角坠下 / 整口坠池的倾角（弧度，TS TILT_CORNER / TILT_FALLEN）</summary>
        public const float TiltCorner = 0.6f, TiltFallen = 1.15f;
        /// <summary>一角坠下 / 整口坠池的下落时长（秒，加速下落）</summary>
        public const float CornerDrop = 0.55f, FallDrop = 1.05f;
        /// <summary>链环原始长度（米，链环模型 Y 向）与节距（米，下一节的起点）</summary>
        public const float LinkLength = 1f, LinkPitch = 0.68f;
        /// <summary>崩飞的链节多久散尽（秒）</summary>
        public const float SnapTime = 1.6f;

        static readonly Color Bronze = Hex.Rgb(0x5a4422), Verdigris = Hex.Rgb(0x3e5040), Dark = Hex.Rgb(0x2a2018), Molten = Hex.Rgb(0xff6a1a), IronLink = Hex.Rgb(0x2a2422);

        [Tooltip("鼎身中心离熔池地面多高（米）")] public float hangHeight = 7.2f;
        [Tooltip("一角坠下时角足砸在离圆心 熔池半径 + 这么多 米处（饮熔的麒麟头在这一带）")] public float impactOut = 1.0f;
        [Tooltip("四个锁扣（与 QilinFurnace 的象限同序）")] public QilinLock[] locks = Array.Empty<QilinLock>();
        [Tooltip("炉心殿几何（空 = 找最近的）")] public QilinFurnace furnace;
        [Tooltip("链环模板（停用的 SM_Prop_InfernoChainLink 实例；空 = 程序方块链环）")] public GameObject linkTemplate;
        [Tooltip("链环缩放（巨链：1.5 = 1.5 m 一节）")] public float linkScale = 1.5f;

        static readonly List<QilinCauldron> all = new();

        public static IReadOnlyList<QilinCauldron> All => all;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics() => all.Clear();

        public CauldronState State { get; private set; } = CauldronState.Hang;
        /// <summary>最近坠下的那一角（−1 = 没有）</summary>
        public int DroppedCorner { get; private set; } = -1;
        /// <summary>坠下过几角（测试用）</summary>
        public int Drops { get; private set; }
        /// <summary>坠池落定后的掩体碰撞盒</summary>
        public BoxCollider Cover { get; private set; }
        /// <summary>鼎的姿势根（鼎身中心）</summary>
        public Transform Ding => ding;

        /// <summary>撞击（吊鼎, 是否整口坠池, 撞击点）：一角砸在池沿 / 整口砸进熔池</summary>
        public event Action<QilinCauldron, bool, Vector3> Impact;

        enum ChainState { Taut, Falling, Gone }

        sealed class Chain
        {
            public ChainState state;
            public float t;
            public Vector3 from;
            public readonly List<Transform> links = new();
            public Vector3[] scatter;
        }

        Transform ding, model, fallenModel, linkRoot;
        readonly List<Chain> chains = new();
        readonly List<Vector3> cornerDirs = new();
        Quaternion restRot, fromRot, toRot;
        Vector3 restPos, fromPos, toPos, impact;
        float moveT = 1, moveDur = 0.6f, age, sway;
        bool built;
        GameObject proceduralLink;

        void Awake() => Build();

        void OnEnable()
        {
            if (!all.Contains(this)) all.Add(this);
        }

        void OnDisable() => all.Remove(this);

        /// <summary>离 near 最近的吊鼎（没给 near 取第一个）</summary>
        public static QilinCauldron Nearest(Vector3? near)
        {
            QilinCauldron best = null;
            float bestD = float.PositiveInfinity;
            foreach (var c in all)
            {
                if (!c) continue;
                float d = near.HasValue ? (c.transform.position - near.Value).sqrMagnitude : 0;
                if (d >= bestD) continue;
                best = c;
                bestD = d;
            }
            return best;
        }

        /// <summary>
        /// 测试场 / 关卡没摆时运行时建一套：熔池圆心上的吊鼎 + 四个锁扣（象限中线、殿墙内侧 0.6 m、离地 lockHeight，朝殿心）
        /// </summary>
        public static QilinCauldron CreateRuntime(QilinFurnace f, float lockHeight = 12f, Transform parent = null)
        {
            if (!f) return null;
            var go = new GameObject("Qilin Cauldron (runtime)");
            go.SetActive(false);
            go.transform.SetParent(parent, false);
            go.transform.position = f.Center;
            var c = go.AddComponent<QilinCauldron>();
            c.furnace = f;
            c.hangHeight = Mathf.Clamp(lockHeight - 4.8f, 5.5f, 9f);
            var list = new QilinLock[f.QuadrantCount];
            for (int i = 0; i < list.Length; i++)
            {
                var p = f.Point(f.QuadrantYaw(i), f.wallRadius - 0.6f) + Vector3.up * lockHeight;
                var lgo = new GameObject($"Qilin Lock {i} (runtime)");
                lgo.transform.SetParent(parent, false);
                lgo.transform.SetPositionAndRotation(p, Quaternion.LookRotation(Flat(f.Center - p)));
                var l = lgo.AddComponent<QilinLock>();
                l.index = i;
                list[i] = l;
            }
            c.locks = list;
            go.SetActive(true);
            return c;
        }

        /// <summary>搭外观、巨链，记下吊着的姿势（只做一次）</summary>
        public void Build()
        {
            if (built) return;
            built = true;
            if (!furnace) furnace = QilinFurnace.Nearest(transform.position);
            ding = new GameObject("Ding").transform;
            ding.SetParent(transform, false);
            // 四个角正对四个象限中线：局部角方向 (±1, ±1)/√2，整体绕 Y 转 yaw0 = 第一个象限 − 45°
            float yaw0 = (furnace && furnace.QuadrantCount > 0 ? furnace.QuadrantYaw(0) : 45f) - 45f;
            restRot = Quaternion.Euler(0, yaw0, 0);
            restPos = transform.position + Vector3.up * hangHeight;
            ding.SetPositionAndRotation(restPos, restRot);
            fromPos = toPos = restPos;
            fromRot = toRot = restRot;

            var art = transform.Find("Model");
            if (art)
            {
                art.SetParent(ding, true);
                model = art;
            }
            else model = BuildModel();
            fallenModel = transform.Find("Model (fallen)");
            if (fallenModel)
            {
                fallenModel.gameObject.SetActive(false);
                fallenModel.SetParent(ding, true);
            }

            int n = Mathf.Max(locks?.Length ?? 0, furnace ? furnace.QuadrantCount : 4);
            for (int i = 0; i < n; i++)
            {
                float yaw = furnace && furnace.QuadrantCount > 0 ? furnace.QuadrantYaw(i) : 90f * i;
                var world = Quaternion.Euler(0, yaw, 0) * Vector3.forward;
                var local = Quaternion.Inverse(restRot) * world;
                local.y = 0;
                // 吸到最近的方鼎对角（±1, ±1）
                local = new Vector3(Mathf.Sign(local.x == 0 ? 1 : local.x), 0, Mathf.Sign(local.z == 0 ? 1 : local.z)).normalized;
                cornerDirs.Add(local);
            }
            linkRoot = new GameObject("Chains").transform;
            linkRoot.SetParent(transform, false);
            for (int i = 0; i < n; i++)
            {
                var ch = new Chain { state = HasLock(i) ? ChainState.Taut : ChainState.Gone };
                chains.Add(ch);
                if (ch.state == ChainState.Taut) BuildLinks(i, ch);
            }
            if (linkTemplate) linkTemplate.SetActive(false);
            UpdateChains(0, true);
        }

        bool HasLock(int i) => locks != null && i < locks.Length && locks[i];

        // ───────────── 外观 ─────────────

        /// <summary>程序方鼎（ART6 暂缓期间的运行时外观；尺寸照 TS QilinCauldron 与 registry 的 SM_Prop_QilinCauldron 6.4 × 8 × 6.4 m）</summary>
        Transform BuildModel()
        {
            var root = new GameObject("Model (procedural)").transform;
            root.SetParent(ding, false);
            PropBits.Box(root, "Body", Vector3.zero, new Vector3(Half * 2, HalfY * 2, Half * 2), Bronze);
            PropBits.Box(root, "Rim", new Vector3(0, HalfY - 0.1f, 0), new Vector3(Half * 2 + 0.5f, 0.35f, Half * 2 + 0.5f), Dark);
            PropBits.Box(root, "Waist", new Vector3(0, -0.4f, 0), new Vector3(Half * 2 + 0.15f, 0.25f, Half * 2 + 0.15f), Verdigris);
            for (int k = 0; k < 4; k++)
            {
                float a = k * 90f;
                var dir = Quaternion.Euler(0, a, 0) * Vector3.forward;
                var face = PropBits.Box(root, "Taotie", dir * (Half + 0.05f) + Vector3.up * 0.35f, new Vector3(1.6f, 1.1f, 0.25f), Verdigris);
                face.transform.localRotation = Quaternion.Euler(0, a, 0);
            }
            foreach (int s in new[] { -1, 1 })
            {
                PropBits.Box(root, "Ear", new Vector3(s * (Half - 0.7f), HalfY + 0.8f, 0), new Vector3(0.3f, 1.5f, 1.5f), Dark);
                PropBits.Box(root, "Ear Hole", new Vector3(s * (Half - 0.7f), HalfY + 0.85f, 0), new Vector3(0.32f, 0.7f, 0.7f), Molten * 0.25f);
            }
            foreach (var c in new[] { new Vector2(1, 1), new Vector2(-1, 1), new Vector2(-1, -1), new Vector2(1, -1) })
            {
                PropBits.Cylinder(root, "Leg", new Vector3(c.x * LegIn, -HalfY - Leg * 0.5f + 0.2f, c.y * LegIn), new Vector3(0.76f, Leg, 0.76f), Dark);
                PropBits.Box(root, "Foot", new Vector3(c.x * LegIn, -HalfY - Leg + 0.25f, c.y * LegIn), new Vector3(0.95f, 0.5f, 0.95f), Bronze);
                // 角上拴巨链的铁环
                PropBits.Box(root, "Shackle", new Vector3(c.x * Half * 0.98f, HalfY + 0.35f, c.y * Half * 0.98f), new Vector3(0.6f, 0.7f, 0.6f), IronLink);
            }
            var lava = PropBits.Box(root, "Molten", new Vector3(0, HalfY - 0.12f, 0), new Vector3(Half * 2 - 0.3f, 0.06f, Half * 2 - 0.3f), Molten);
            lava.sharedMaterial = FxMaterials.Unlit;
            FxMaterials.Tint(lava, Molten * 1.4f);
            return root;
        }

        /// <summary>程序链环（没有链环模板时）：长 1 m、宽 0.65 m 的方环，底端在原点，沿 +Y</summary>
        GameObject ProceduralLink()
        {
            if (proceduralLink) return proceduralLink;
            var go = new GameObject("Chain Link (procedural)");
            go.SetActive(false);
            go.transform.SetParent(transform, false);
            PropBits.Box(go.transform, "Side L", new Vector3(-0.25f, 0.5f, 0), new Vector3(0.16f, 1f, 0.16f), IronLink);
            PropBits.Box(go.transform, "Side R", new Vector3(0.25f, 0.5f, 0), new Vector3(0.16f, 1f, 0.16f), IronLink);
            PropBits.Box(go.transform, "End B", new Vector3(0, 0.08f, 0), new Vector3(0.65f, 0.16f, 0.16f), IronLink);
            PropBits.Box(go.transform, "End T", new Vector3(0, 0.92f, 0), new Vector3(0.65f, 0.16f, 0.16f), IronLink);
            return proceduralLink = go;
        }

        void BuildLinks(int i, Chain ch)
        {
            var a = Anchor(i);
            var b = LockPoint(i);
            float len = Vector3.Distance(a, b);
            float pitch = LinkPitch * linkScale;
            int n = Mathf.Max(2, Mathf.CeilToInt(len / pitch));
            var tpl = linkTemplate ? linkTemplate : ProceduralLink();
            for (int k = 0; k < n; k++)
            {
                var link = Instantiate(tpl, linkRoot, false);
                link.name = $"Link {i}.{k}";
                link.SetActive(true);
                link.transform.localScale = Vector3.one * linkScale;
                foreach (var col in link.GetComponentsInChildren<Collider>(true)) Destroy(col);
                ch.links.Add(link.transform);
            }
            ch.scatter = new Vector3[n];
            for (int k = 0; k < n; k++)
            {
                float ang = (k * 2.399f + i) % (Mathf.PI * 2);
                ch.scatter[k] = new Vector3(Mathf.Sin(ang) * (1 + k % 5 * 0.4f), 2 + k % 3, Mathf.Cos(ang) * (1 + k % 4 * 0.4f));
            }
        }

        // ───────────── 查询 ─────────────

        /// <summary>链 i 还拴着</summary>
        public bool ChainIntact(int i) => i >= 0 && i < chains.Count && chains[i].state == ChainState.Taut;

        /// <summary>拴着的链数</summary>
        public int IntactCount
        {
            get
            {
                int n = 0;
                foreach (var c in chains)
                    if (c.state == ChainState.Taut)
                        n++;
                return n;
            }
        }

        public int ChainCount => chains.Count;

        /// <summary>鼎角 i 的铁环（世界坐标，当前姿势）：巨链从这里拉到锁扣</summary>
        public Vector3 Anchor(int i)
        {
            var d = CornerDir(i);
            return ding.TransformPoint(new Vector3(d.x * Half * 0.98f * Mathf.Sqrt(2f), HalfY + 0.35f, d.z * Half * 0.98f * Mathf.Sqrt(2f)));
        }

        /// <summary>鼎角 i 的足尖（世界坐标，当前姿势）</summary>
        public Vector3 CornerTip(int i)
        {
            var d = CornerDir(i);
            return ding.TransformPoint(LegTipLocal(d));
        }

        static Vector3 LegTipLocal(Vector3 d) => new(d.x * LegIn * Mathf.Sqrt(2f), -HalfY - Leg + 0.2f, d.z * LegIn * Mathf.Sqrt(2f));

        Vector3 CornerDir(int i) => cornerDirs.Count == 0 ? new Vector3(1, 0, 1).normalized : cornerDirs[Mathf.Clamp(i, 0, cornerDirs.Count - 1)];

        /// <summary>锁扣 i 拴链的点（没有锁扣时取殿墙上对应象限的高处）</summary>
        public Vector3 LockPoint(int i)
        {
            if (HasLock(i))
            {
                var l = locks[i];
                return l.ChainPoint ? l.ChainPoint.position : l.transform.position + Vector3.up * 1.5f;
            }
            if (furnace) return furnace.Point(furnace.QuadrantYaw(i), furnace.wallRadius - 0.6f) + Vector3.up * (hangHeight + 5f);
            return transform.position + Quaternion.Euler(0, 90f * i, 0) * Vector3.forward * 20f + Vector3.up * (hangHeight + 5f);
        }

        /// <summary>一角坠下时砸在哪（象限 i 方向，池沿外 impactOut 米，离地 1 m）</summary>
        public Vector3 CornerImpactPoint(int i)
        {
            float yaw = furnace && furnace.QuadrantCount > 0 ? furnace.QuadrantYaw(i) : 90f * i;
            float pool = furnace ? furnace.poolRadius : 7f;
            var c = transform.position;
            var d = Quaternion.Euler(0, yaw, 0) * Vector3.forward;
            return new Vector3(c.x + d.x * (pool + impactOut), c.y + 1f, c.z + d.z * (pool + impactOut));
        }

        // ───────────── 坠下 ─────────────

        /// <summary>
        /// 锁扣 i 碎了：那条链崩飞，鼎朝那一角倾倒，角足斜砸在池沿上（<see cref="CornerDrop"/> 秒后派发 Impact）。
        /// 已经坠池、或那条链早断了时什么都不做，返回 false；impactAt = 撞击点
        /// </summary>
        public bool DropCorner(int i, out Vector3 impactAt)
        {
            impactAt = default;
            if (!built) Build();
            if (State is CauldronState.Falling or CauldronState.Fallen || !ChainIntact(i)) return false;
            Snap(i);
            float yaw = furnace && furnace.QuadrantCount > 0 ? furnace.QuadrantYaw(i) : 90f * i;
            var d = Quaternion.Euler(0, yaw, 0) * Vector3.forward;
            // 先转回吊着的朝向，再绕 (d.z, 0, −d.x) 倾斜（d 那一侧朝下）
            var axis = new Vector3(d.z, 0, -d.x);
            toRot = Quaternion.AngleAxis(TiltCorner * Mathf.Rad2Deg, axis) * restRot;
            impact = CornerImpactPoint(i);
            toPos = impact - toRot * LegTipLocal(CornerDir(i));
            BeginMove(CornerDrop);
            State = CauldronState.Corner;
            DroppedCorner = i;
            Drops++;
            impactAt = impact;
            return true;
        }

        /// <summary>剩下的链全断，鼎整个砸进熔池（翻倒、半露），<see cref="FallDrop"/> 秒后落定成为掩体。已经在坠 / 落定时不重复</summary>
        public void Fall()
        {
            if (!built) Build();
            if (State is CauldronState.Falling or CauldronState.Fallen) return;
            for (int i = 0; i < chains.Count; i++)
                if (chains[i].state == ChainState.Taut)
                    Snap(i);
            float side = DroppedCorner >= 0 && furnace ? furnace.QuadrantYaw(DroppedCorner) : furnace && furnace.QuadrantCount > 0 ? furnace.QuadrantYaw(0) : 0;
            var d = Quaternion.Euler(0, side, 0) * Vector3.forward;
            toRot = Quaternion.Euler(0, 28.6f, 0) * Quaternion.AngleAxis(TiltFallen * Mathf.Rad2Deg, new Vector3(d.z, 0, -d.x)) * restRot;
            toPos = transform.position + Vector3.up * 0.6f;
            impact = toPos;
            BeginMove(FallDrop);
            State = CauldronState.Falling;
        }

        void BeginMove(float dur)
        {
            fromPos = ding.position;
            fromRot = ding.rotation;
            moveT = 0;
            moveDur = Mathf.Max(0.05f, dur);
            sway = 0;
        }

        /// <summary>断链：锁扣与鼎角两头迸火星，链节崩飞</summary>
        void Snap(int i)
        {
            var ch = chains[i];
            if (ch.state != ChainState.Taut) return;
            ch.from = Anchor(i);
            ch.state = ChainState.Falling;
            ch.t = 0;
            var lockAt = LockPoint(i);
            Fx.Burst(lockAt, Hex.Rgb(0xffb050), 22, 9f, 0.7f, 0.25f, 12f);
            Fx.Burst(ch.from, Hex.Rgb(0xffb050), 16, 7f, 0.7f, 0.25f, 12f);
            GameAudio.PlayAt("shield_break", lockAt, 0.9f, 0.5f);
        }

        void Land()
        {
            State = CauldronState.Fallen;
            // 翻倒半露的鼎：池中掩体（挡吐息、挡视线），盒子在熔池里（世界轴对齐，同 TS 的 addBox）
            var c = transform.position;
            float h = Half * 0.95f;
            var go = new GameObject("Fallen Cauldron Cover") { layer = 0 };
            go.transform.SetParent(transform, false);
            go.transform.SetPositionAndRotation(new Vector3(c.x, c.y + 1.7f, c.z), Quaternion.identity);
            Cover = go.AddComponent<BoxCollider>();
            Cover.size = new Vector3(h * 2, 5.4f, h * 2);
            if (fallenModel)
            {
                fallenModel.gameObject.SetActive(true);
                if (model) model.gameObject.SetActive(false);
            }
            var molten = model ? model.Find("Molten") : null;
            if (molten) molten.gameObject.SetActive(false);
            RaiseImpact(true, impact);
        }

        void RaiseImpact(bool fallen, Vector3 at)
        {
            if (Impact == null) return;
            try
            {
                Impact(this, fallen, at);
            }
            catch (Exception e)
            {
                Debug.LogException(e);
            }
        }

        // ───────────── 每帧 ─────────────

        void Update()
        {
            if (!built) return;
            float dt = Time.deltaTime;
            age += dt;
            bool moved = false;
            if (moveT < 1f)
            {
                // 加速下落（ease-in），落定后余摆
                moveT = Mathf.Min(1f, moveT + dt / moveDur);
                float e = moveT * moveT;
                ding.SetPositionAndRotation(Vector3.Lerp(fromPos, toPos, e), Quaternion.Slerp(fromRot, toRot, e));
                moved = true;
                if (moveT >= 1f)
                {
                    sway = 1f;
                    if (State == CauldronState.Falling) Land();
                    else RaiseImpact(false, impact);
                }
            }
            else if (State != CauldronState.Fallen)
            {
                // 吊着 / 斜挂：轻轻摆（斜挂的摆得大一点）
                sway = Mathf.Max(0.12f, sway - dt * 0.6f);
                float w = Mathf.Sin(age * 1.3f) * 0.025f * sway * (State == CauldronState.Corner ? 2f : 1f);
                ding.rotation = Quaternion.AngleAxis(w * Mathf.Rad2Deg, Vector3.right) * toRot;
                moved = true;
            }
            UpdateChains(dt, moved);
        }

        void UpdateChains(float dt, bool dirty)
        {
            for (int i = 0; i < chains.Count; i++)
            {
                var ch = chains[i];
                if (ch.state == ChainState.Gone) continue;
                if (ch.state == ChainState.Falling)
                {
                    ch.t += dt;
                    if (ch.t >= SnapTime)
                    {
                        ch.state = ChainState.Gone;
                        foreach (var l in ch.links)
                            if (l)
                                l.gameObject.SetActive(false);
                        continue;
                    }
                }
                else if (!dirty) continue;
                var from = ch.state == ChainState.Taut ? Anchor(i) : ch.from;
                var to = LockPoint(i);
                var span = to - from;
                float len = span.magnitude;
                if (len < 1e-3f) continue;
                var dir = span / len;
                var baseRot = Quaternion.FromToRotation(Vector3.up, dir);
                int n = ch.links.Count;
                float pitch = len / Mathf.Max(1, n);
                float t = ch.t;
                for (int k = 0; k < n; k++)
                {
                    var l = ch.links[k];
                    if (!l) continue;
                    float u = (k + 0.5f) / n;
                    var p = from + dir * (pitch * k);
                    // 微微下垂
                    p.y -= Mathf.Sin(u * Mathf.PI) * len * 0.02f;
                    float scale = linkScale;
                    if (ch.state == ChainState.Falling)
                    {
                        var s = ch.scatter[k];
                        p += new Vector3(s.x * t, s.y * t - 9f * t * t, s.z * t);
                        scale *= Mathf.Max(0.01f, 1f - t / SnapTime);
                    }
                    l.SetPositionAndRotation(p, baseRot * Quaternion.Euler(0, k % 2 == 0 ? 0 : 90f, 0));
                    l.localScale = Vector3.one * scale;
                }
            }
        }

        static Vector3 Flat(Vector3 v)
        {
            v.y = 0;
            return v.sqrMagnitude > 1e-6f ? v.normalized : Vector3.forward;
        }

        void OnDrawGizmos()
        {
            var c = transform.position + Vector3.up * hangHeight;
            Gizmos.color = new Color(0.8f, 0.6f, 0.3f, 0.9f);
            Gizmos.DrawWireCube(c, new Vector3(Half * 2, HalfY * 2, Half * 2));
            if (locks == null) return;
            Gizmos.color = new Color(0.3f, 0.3f, 0.3f, 0.9f);
            foreach (var l in locks)
                if (l)
                    Gizmos.DrawLine(c + Vector3.up * HalfY, l.transform.position);
        }
    }
}
