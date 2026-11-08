using Spiritfire.Art;
using UnityEngine;

namespace Spiritfire.Game
{
    public sealed class GunfireOriginalAnimation : MonoBehaviour
    {
        public string weaponId;
        public GameObject muzzlePrefab;
        public AudioClip[] shotClips = System.Array.Empty<AudioClip>();
        public AudioClip[] reloadClips = System.Array.Empty<AudioClip>();
        public AudioClip[] reloadDetailClips = System.Array.Empty<AudioClip>();
        public int fireCount, reloadCount;
        public string lastTrigger;

        /// <summary>
        /// 枪口特效整体缩放：1926_muzzle 是原作的通用枪口（材质混着 Boss / 怪物 / 技能特效），按原尺寸挂到第一人称枪口上，
        /// 烟团 2 m 多、光晕 4 m，而枪口离镜头只有约 0.45 m，连射叠起来满屏发白。粒子缩放模式是 Hierarchy，整体缩小即按比例缩小
        /// </summary>
        public static float MuzzleScale = 0.12f;

        /// <summary>
        /// 枪口特效相对挂点的旋转：1926_muzzle 自身沿 -Y 喷（火星 / 刺 / 烟的速度、光晕和烟的位置都在 -Y），
        /// 挂点（枪骨骼）的射向是 -X；不转的话整团火光朝枪管侧面炸开
        /// </summary>
        public static Quaternion MuzzleFxRotation = Quaternion.Euler(0, 0, -90);

        public const string AnchorName = "MuzzleFx";

        Transform muzzleAnchor;
        /// <summary>
        /// 枪口特效挂点：Awake 时在枪管口顶点实际蒙皮的那根骨骼下建的 MuzzleFx，放在 Att（原作标定的枪口点）上。
        /// Att 挂在枪根骨骼上，但枪管口往往蒙在它的子骨骼上（左轮 1202_Bone003：开火时枪管 / 转轮这组单独上翻，挂 Att 会漂 4 cm）；
        /// 原 muzzle 节点挂在不动的 Home / _Right 下，后坐时留在原地
        /// </summary>
        public Transform MuzzleAnchor => muzzleAnchor ? muzzleAnchor : muzzleAnchor = BuildAnchor();

        /// <summary>曳光起点等外部用：已建好的 MuzzleFx，没有就 Att，再没有就 muzzle 节点</summary>
        public static Transform FindAnchor(Transform gun)
        {
            if (!gun) return null;
            var side = RightSide(gun);
            var built = WeaponSockets.FindDeep(side, AnchorName);
            if (built) return built;
            var att = WeaponSockets.FindDeep(side, "Att");
            return att ? att : WeaponSockets.FindDeep(side, WeaponSockets.Muzzle);
        }

        static Transform RightSide(Transform gun)
        {
            foreach (Transform child in gun)
                if (child.name.EndsWith("_Right", System.StringComparison.Ordinal)) return child;
            return gun;
        }

        Transform BuildAnchor()
        {
            var side = RightSide(transform);
            var existing = WeaponSockets.FindDeep(side, AnchorName);
            if (existing) return existing;
            var att = FindAnchor(transform);
            if (!att) return null;
            var bone = TipBone(att) ?? att.parent;
            if (!bone) return att;
            var anchor = new GameObject(AnchorName).transform;
            anchor.SetParent(bone, false);
            // 骨骼与 Att 之间没有镜像，用矩阵求相对位姿（父级里有 -X 缩放，直接设世界旋转不可靠）
            var rel = bone.worldToLocalMatrix * att.localToWorldMatrix;
            anchor.localPosition = rel.GetColumn(3);
            anchor.localRotation = Quaternion.LookRotation(rel.GetColumn(2), rel.GetColumn(1));
            anchor.localScale = new Vector3(((Vector3)rel.GetColumn(0)).magnitude, ((Vector3)rel.GetColumn(1)).magnitude, ((Vector3)rel.GetColumn(2)).magnitude);
            anchor.gameObject.layer = att.gameObject.layer;
            return anchor;
        }

        /// <summary>Att 周围 3 cm 内枪身顶点（不含手臂）权重最大的骨骼</summary>
        Transform TipBone(Transform att)
        {
            var weight = new System.Collections.Generic.Dictionary<Transform, float>();
            var mesh = new Mesh();
            foreach (var smr in GetComponentsInChildren<SkinnedMeshRenderer>())
            {
                if (!smr.enabled || !smr.sharedMesh || smr.name.StartsWith("hero_fpp_", System.StringComparison.Ordinal)) continue;
                smr.BakeMesh(mesh, true);
                mesh.GetVertices(bakedVerts);
                var m = smr.transform.localToWorldMatrix;
                var bw = smr.sharedMesh.boneWeights;
                var bones = smr.bones;
                for (int i = 0; i < bakedVerts.Count && i < bw.Length; i++)
                {
                    if ((m.MultiplyPoint3x4(bakedVerts[i]) - att.position).sqrMagnitude > 0.03f * 0.03f) continue;
                    void Add(int index, float w)
                    {
                        if (w <= 0 || index < 0 || index >= bones.Length || !bones[index]) return;
                        weight.TryGetValue(bones[index], out float old);
                        weight[bones[index]] = old + w;
                    }
                    Add(bw[i].boneIndex0, bw[i].weight0);
                    Add(bw[i].boneIndex1, bw[i].weight1);
                    Add(bw[i].boneIndex2, bw[i].weight2);
                    Add(bw[i].boneIndex3, bw[i].weight3);
                }
            }
            Destroy(mesh);
            Transform best = null;
            float most = 0;
            foreach (var kv in weight)
                if (kv.Value > most)
                {
                    most = kv.Value;
                    best = kv.Key;
                }
            return best;
        }
        /// <summary>挂点的射向（世界，含父级镜像缩放）</summary>
        public Vector3 MuzzleForward => MuzzleAnchor ? MuzzleAnchor.TransformVector(Vector3.left).normalized : transform.forward;
        /// <summary>最近一次开火播放的枪口特效（测试用）</summary>
        public GameObject LastMuzzleFx { get; private set; }
        /// <summary>对象池里的枪口特效实例数（测试用）</summary>
        public int MuzzleFxPooled => muzzlePool.Count;

        /// <summary>
        /// 连射时烟最多每这么久喷一次：1926_muzzle 每发 5 + 3 团烟、活 1 s，冲锋枪 13 发 / s 连射时在相机空间堆成一堵烟墙挡视线；
        /// 左轮 / 电磁炮的射速低于这个间隔，每发照旧带烟
        /// </summary>
        public static float SmokeInterval = 0.22f;
        /// <summary>枪口特效池上限：一发的火光 0.35 s、带烟的 1 s，冲锋枪连射同时活着的不超过 8 份；满了重用最早那份</summary>
        const int MuzzlePoolMax = 10;

        sealed class MuzzleFx
        {
            public GameObject go;
            public ParticleSystem[] systems, smoke;
            public Vector3[] baseScales;
            public float playedAt, fittedScale = float.NaN;

            public bool Alive
            {
                get
                {
                    foreach (var ps in systems) if (ps && ps.IsAlive(false)) return true;
                    return false;
                }
            }
        }

        readonly System.Collections.Generic.List<MuzzleFx> muzzlePool = new();
        float lastSmokeAt = float.NegativeInfinity;

        /// <summary>
        /// 每发从池里取一份枪口特效重播（原来每发 Instantiate 一整棵 30 个节点的预制体、3 s 后销毁，冲锋枪连射同时挂着 40 份）。
        /// 火光 / 光环 / 射线是局部空间，跟着枪骨骼一起后坐；烟、火星、刺原本是世界空间，第一人称下走路转身会被甩过整个屏幕，
        /// 改到相机空间：从枪口喷出后留在视野里原处，枪后坐时与枪拉开、自然漂移
        /// </summary>
        void PlayMuzzleFx()
        {
            var anchor = MuzzleAnchor;
            if (!muzzlePrefab || !anchor) return;
            MuzzleFx fx = null, oldest = null;
            muzzlePool.RemoveAll(f => !f.go);
            foreach (var f in muzzlePool)
            {
                if (!f.Alive)
                {
                    fx = f;
                    break;
                }
                if (oldest == null || f.playedAt < oldest.playedAt) oldest = f;
            }
            if (fx == null && muzzlePool.Count < MuzzlePoolMax) fx = CreateMuzzleFx(anchor);
            fx ??= oldest;
            if (fx == null) return;
            fx.go.transform.SetParent(anchor, false);
            fx.go.transform.SetLocalPositionAndRotation(Vector3.zero, MuzzleFxRotation);
            fx.go.transform.localScale = Vector3.one * MuzzleScale;
            if (!(fx.fittedScale == MuzzleScale)) FitToBarrel(fx);
            bool smoke = Time.time - lastSmokeAt >= SmokeInterval;
            if (smoke) lastSmokeAt = Time.time;
            foreach (var ps in fx.systems)
            {
                if (!ps) continue;
                ps.Stop(false, ParticleSystemStopBehavior.StopEmittingAndClear);
                if (smoke || System.Array.IndexOf(fx.smoke, ps) < 0) ps.Play(false);
            }
            fx.playedAt = Time.time;
            LastMuzzleFx = fx.go;
        }

        MuzzleFx CreateMuzzleFx(Transform anchor)
        {
            var go = Instantiate(muzzlePrefab, anchor, false);
            PlayerFactory.SetLayer(go, Layers.FirstPerson);
            var view = ViewSpace;
            // 预制体里关着的分支（converge 一整支、spark、smoke_01 …）从来不播，不进池
            var systems = System.Linq.Enumerable.ToArray(System.Linq.Enumerable.Where(go.GetComponentsInChildren<ParticleSystem>(false), ps => ps.gameObject.activeInHierarchy));
            foreach (var ps in systems)
            {
                var main = ps.main;
                if (view && main.simulationSpace == ParticleSystemSimulationSpace.World)
                {
                    main.simulationSpace = ParticleSystemSimulationSpace.Custom;
                    main.customSimulationSpace = view;
                }
            }
            var fx = new MuzzleFx
            {
                go = go,
                systems = systems,
                smoke = System.Array.FindAll(systems, ps => ps.name.IndexOf("smoke", System.StringComparison.OrdinalIgnoreCase) >= 0),
                baseScales = System.Array.ConvertAll(systems, ps => ps.transform.localScale),
            };
            muzzlePool.Add(fx);
            return fx;
        }

        /// <summary>
        /// 各子系统最大尺寸相对枪管口直径的上限：1926_muzzle 按整体缩放挂上来，光环 / 扩散环仍是枪管口的 8–19 倍、光晕 23 倍、射线 10 倍、烟 20 倍。
        /// 光环贴着枪口一圈（1.5 倍）；射线 / 爆点 9 倍、光晕 10 倍（5 / 6 倍时左轮的星芒缩成一小团、冲击感不够，2026-11-08 用户要放大）；
        /// 烟 5 倍（团在枪口四周，大了像一圈黑甜甜圈）；火星、刺本来就细，不限
        /// </summary>
        public static readonly (string name, float ratio)[] SizeCaps =
        {
            ("ring_01 (1)", 1.5f), ("ring_01 (2)", 1.5f), ("kuosan", 1.5f),
            ("ray", 9f), ("ray (2)", 9f), ("baodian", 9f), ("glow_02", 10f),
            ("Smoke", 5f), ("smoke_02 (1)", 5f),
        };

        /// <summary>最近一次封顶时的缩放（测试用）</summary>
        public string FitDebug { get; private set; }

        float barrelDiameter = -1;
        /// <summary>枪管口直径（世界，m）：首次开火时烘焙枪身网格量一次</summary>
        public float BarrelDiameter => barrelDiameter >= 0 ? barrelDiameter : barrelDiameter = MeasureBarrel();

        /// <summary>按枪管口直径给各子系统的最大尺寸封顶（只缩不放）：缩子系统自己的 Transform，粒子缩放模式是 Hierarchy，尺寸 / 发射半径 / 速度一起按比例缩</summary>
        void FitToBarrel(MuzzleFx fx)
        {
            for (int i = 0; i < fx.systems.Length; i++)
                if (fx.systems[i]) fx.systems[i].transform.localScale = fx.baseScales[i];
            fx.fittedScale = MuzzleScale;
            float barrel = BarrelDiameter;
            FitDebug = $"挂点 {MuzzleAnchor.lossyScale} 特效根 {fx.go.transform.lossyScale} 枪管口 {barrel * 100:F1} cm";
            if (barrel <= 0) return;
            foreach (var ps in fx.systems)
            {
                if (!ps) continue;
                int cap = System.Array.FindIndex(SizeCaps, c => c.name == ps.name);
                if (cap < 0) continue;
                float size = MaxVisualSize(ps), limit = SizeCaps[cap].ratio * barrel;
                if (size > limit) ps.transform.localScale *= limit / size;
            }
        }

        /// <summary>粒子最大可见尺寸（世界，m）：起始尺寸上限 × 尺寸随生命曲线上限 × 网格外形（网格模式）× 层级缩放</summary>
        public static float MaxVisualSize(ParticleSystem ps)
        {
            var main = ps.main;
            var start = main.startSize3D ? new Vector3(Max(main.startSizeX), Max(main.startSizeY), Max(main.startSizeZ)) : Vector3.one * Max(main.startSize);
            var sol = ps.sizeOverLifetime;
            float life = !sol.enabled ? 1 : sol.separateAxes ? Mathf.Max(Max(sol.x), Max(sol.y), Max(sol.z)) : Max(sol.size);
            var renderer = ps.GetComponent<ParticleSystemRenderer>();
            var shape = renderer && renderer.renderMode == ParticleSystemRenderMode.Mesh && renderer.mesh ? renderer.mesh.bounds.size : Vector3.one;
            var s = ps.transform.lossyScale;
            float lossy = Mathf.Max(Mathf.Abs(s.x), Mathf.Abs(s.y), Mathf.Abs(s.z));
            return Mathf.Max(start.x * shape.x, start.y * shape.y, start.z * shape.z) * life * lossy;
        }

        static float Max(ParticleSystem.MinMaxCurve c) => c.mode switch
        {
            ParticleSystemCurveMode.Constant => c.constant,
            ParticleSystemCurveMode.TwoConstants => Mathf.Max(c.constantMin, c.constantMax),
            ParticleSystemCurveMode.Curve => c.curveMultiplier * MaxKey(c.curve),
            ParticleSystemCurveMode.TwoCurves => c.curveMultiplier * Mathf.Max(MaxKey(c.curveMin), MaxKey(c.curveMax)),
            _ => 1,
        };

        static float MaxKey(AnimationCurve curve)
        {
            if (curve == null || curve.length == 0) return 1;
            float max = float.NegativeInfinity;
            foreach (var k in curve.keys) max = Mathf.Max(max, k.value);
            return max;
        }

        static readonly System.Collections.Generic.List<Vector3> bakedVerts = new();

        /// <summary>
        /// 枪管口直径：以 Att（原作标定的枪口中心）为轴，枪身网格（不含手臂）离轴 4 cm 内、沿射向最靠前 1 cm 的顶点离轴距离的中位数 × 2
        /// （取中位数，准星 / 护套这类凸出不把枪口量大）
        /// </summary>
        float MeasureBarrel()
        {
            var anchor = MuzzleAnchor;
            if (!anchor) return 0;
            var axis = MuzzleForward;
            var origin = anchor.position;
            var points = new System.Collections.Generic.List<Vector3>();
            var mesh = new Mesh();
            foreach (var smr in GetComponentsInChildren<SkinnedMeshRenderer>())
            {
                if (!smr.enabled || !smr.sharedMesh || smr.name.StartsWith("hero_fpp_", System.StringComparison.Ordinal)) continue;
                smr.BakeMesh(mesh, true);
                mesh.GetVertices(bakedVerts);
                var m = smr.transform.localToWorldMatrix;
                foreach (var v in bakedVerts)
                {
                    var p = m.MultiplyPoint3x4(v) - origin;
                    if (Vector3.ProjectOnPlane(p, axis).sqrMagnitude < 0.04f * 0.04f) points.Add(p);
                }
            }
            Destroy(mesh);
            if (points.Count == 0) return 0;
            float front = float.NegativeInfinity;
            foreach (var p in points) front = Mathf.Max(front, Vector3.Dot(p, axis));
            var radii = points.FindAll(p => Vector3.Dot(p, axis) > front - 0.01f).ConvertAll(p => Vector3.ProjectOnPlane(p, axis).magnitude);
            radii.Sort();
            return radii[radii.Count / 2] * 2;
        }

        Transform viewSpace;
        /// <summary>枪模所在的相机（枪模挂在主相机下）：烟 / 火星的模拟空间</summary>
        Transform ViewSpace
        {
            get
            {
                if (!viewSpace)
                {
                    var cam = GetComponentInParent<Camera>(true);
                    viewSpace = cam ? cam.transform : null;
                }
                return viewSpace;
            }
        }

        WeaponController controller;
        Animator[] animators = System.Array.Empty<Animator>();
        AudioSource audioSource;
        Light[] fireLights = System.Array.Empty<Light>();
        float lightOffAt;
        bool fullCharge, charging;

        public void Bind(WeaponController weapon)
        {
            if (controller)
            {
                controller.Fired -= OnFired;
                controller.Noted -= OnNoted;
            }
            controller = weapon;
            Cache();
            if (!controller) return;
            controller.Fired += OnFired;
            controller.Noted += OnNoted;
        }

        void Awake()
        {
            Cache();
            if (!audioSource)
            {
                audioSource = gameObject.AddComponent<AudioSource>();
                audioSource.playOnAwake = false;
                audioSource.spatialBlend = 0;
                audioSource.volume = 0.8f;
            }
            // 原作左右两套各一盏 FireLight（左套只拿来显示左手），挂在不动的 muzzle 节点上：只留右套那盏，挪到枪口挂点上跟着后坐走，
            // 白光改成和枪口火光一样的暖黄
            var lights = GetComponentsInChildren<Light>(true);
            foreach (var light in lights) light.enabled = false;
            var keep = System.Array.Find(lights, l => IsUnderRight(l.transform)) ?? (lights.Length > 0 ? lights[0] : null);
            var anchor = MuzzleAnchor;
            if (keep && anchor)
            {
                keep.transform.SetParent(anchor, false);
                keep.transform.SetLocalPositionAndRotation(Vector3.zero, Quaternion.identity);
                keep.color = FireLightColor;
                keep.range = Mathf.Min(keep.range, 6f);
            }
            fireLights = keep ? new[] { keep } : System.Array.Empty<Light>();
            // 枪模是在未激活的 rig 下实例化的，GunfireOriginalWeapon.Instantiate 设曳光起点时 MuzzleFx 还没建（只能先指 Att）：建好后改指它
            var sockets = GetComponent<WeaponSockets>();
            if (sockets && anchor) sockets.muzzle = anchor;
        }

        static readonly Color FireLightColor = new(1f, 0.78f, 0.45f);

        bool IsUnderRight(Transform t)
        {
            for (; t && t != transform; t = t.parent)
                if (t.name.EndsWith("_Right", System.StringComparison.Ordinal)) return true;
            return false;
        }

        void Start() => Bind(GetComponentInParent<WeaponController>());

        void Cache()
        {
            animators = GetComponentsInChildren<Animator>(true);
            foreach (var animator in animators) animator.cullingMode = AnimatorCullingMode.AlwaysAnimate;
        }

        void Update()
        {
            if (weaponId == "1008" && controller)
            {
                var charge = controller.ActiveMode as ChargeMode;
                fullCharge = charge != null && charge.Full;
                bool active = charge != null && charge.Charge > 0;
                if (active && !charging) Trigger("ForceSaving");
                charging = active;
                foreach (var animator in animators)
                    if (animator && HasParameter(animator, "ForceSaving")) animator.SetBool("ForceSaving", charging);
            }
            if (lightOffAt > 0 && Time.time >= lightOffAt)
            {
                foreach (var light in fireLights) if (light) light.enabled = false;
                lightOffAt = 0;
            }
        }

        void OnDestroy()
        {
            if (!controller) return;
            controller.Fired -= OnFired;
            controller.Noted -= OnNoted;
        }

        bool Owns(WeaponInstance weapon) => weapon?.def != null && weapon.def.prefab == $"SK_Weapon_Gunfire{weaponId}";

        void OnFired(WeaponInstance weapon)
        {
            if (!Owns(weapon)) return;
            fireCount++;
            Trigger(weaponId == "1008" && fullCharge ? "ForceShot" : "Fire");
            PlayMuzzleFx();
            foreach (var light in fireLights) if (light) light.enabled = true;
            lightOffAt = Time.time + 0.06f;
            if (shotClips.Length > 0 && audioSource)
                audioSource.PlayOneShot(shotClips[Random.Range(0, shotClips.Length)]);
        }

        void OnNoted(WeaponNote note, WeaponInstance weapon)
        {
            if (note != WeaponNote.ReloadStarted || !Owns(weapon)) return;
            float duration = WeaponStatsResolver.Resolve(weapon, controller.GetComponent<PlayerVitals>()?.stats).reloadTime;
            foreach (var animator in animators)
            {
                if (!animator || !animator.runtimeAnimatorController || !HasParameter(animator, "ReloadSpeed")) continue;
                float length = 0;
                foreach (var clip in animator.runtimeAnimatorController.animationClips)
                    if (clip && clip.name.Contains("Reload")) length = Mathf.Max(length, clip.length);
                animator.SetFloat("ReloadSpeed", length > 0 && duration > 0 ? length / duration : 1f);
            }
            Trigger("Reload");
            reloadCount++;
            if (audioSource)
            {
                if (reloadClips.Length > 0) audioSource.PlayOneShot(reloadClips[Random.Range(0, reloadClips.Length)]);
                if (reloadDetailClips.Length > 0) audioSource.PlayOneShot(reloadDetailClips[Random.Range(0, reloadDetailClips.Length)]);
            }
        }

        void Trigger(string name)
        {
            lastTrigger = name;
            foreach (var animator in animators)
            {
                if (!animator || !animator.runtimeAnimatorController) continue;
                if ((name == "Reload" || name == "ForceSaving") && animator.name.EndsWith("_Left", System.StringComparison.Ordinal)) continue;
                string state = name == "Fire" && animator.name.EndsWith("_Left", System.StringComparison.Ordinal) ? "LeftFire" : name;
                if (name == "Fire" && weaponId == "1008") state = "1008_Fire";
                if (name == "Fire" && weaponId == "1004") state = "1004_Fire01";
                if (name == "Fire" && weaponId is "1003" or "1013" or "1014")
                    state = animator.name.EndsWith("_Left", System.StringComparison.Ordinal) ? "1003_L_Fire02" : "1003_Fire02";
                state = "Base Layer." + state;
                float clipLength = 0;
                foreach (var clip in animator.runtimeAnimatorController.animationClips)
                    if (clip && clip.name.Contains(name == "Fire" && animator.name.EndsWith("_Left", System.StringComparison.Ordinal) ? "_L_Fire" : name)) clipLength = Mathf.Max(clipLength, clip.length);
                lastTrigger += $":{animator.name}={state},enabled={animator.isActiveAndEnabled},clip={clipLength},speed={animator.speed}";
                animator.CrossFade(state, 0.02f, 0, 0f);
                lastTrigger += $",当前={animator.GetCurrentAnimatorStateInfo(0).shortNameHash},下一={animator.GetNextAnimatorStateInfo(0).shortNameHash}";
            }
        }

        static bool HasParameter(Animator animator, string name)
        {
            foreach (var parameter in animator.parameters)
                if (parameter.name == name) return true;
            return false;
        }
    }
}
