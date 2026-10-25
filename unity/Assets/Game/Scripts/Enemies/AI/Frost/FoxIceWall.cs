using System.Collections.Generic;
using UnityEngine;
using UnityEngine.AI;
using UnityEngine.Rendering;

namespace Spiritfire.Game
{
    /// <summary>
    /// 狐巫冰壁（Three.js 版 FoxWitch.ts 的 FoxIceWall / ICE_WALL_DEF）：九尾狐巫在同伴和玩家之间立起的可破坏掩体。
    ///   尺寸：宽 4、高 2.5、厚 0.6 m，墙面朝向玩家（根节点 +Z），沿根节点 +X 展开；切成 6 段碰撞盒。
    ///   真的掩体：碰撞盒在世界层（挡人、挡子弹、挡敌人的视线 / 爆炸 / 光束：命中盒标了 <see cref="Hitbox.blocksSight"/>），
    ///     每段带一个挖洞的 NavMeshObstacle，敌人绕着走；和玩家 / 地面敌人重叠的那一段不立（不把人关进墙里）。
    ///   可破坏：150 血 × 狐巫的强度倍率（<see cref="Damageable"/>，不给奖励、不计击杀），子弹 / 爆炸照常结算，伤得越重裂纹越亮。
    ///   寿命：12 s 后自己崩解（最后 2 s 发白闪烁）；狐巫死了只缩一次寿命到 0.35–0.6 s（几道墙错开碎）。
    ///   碎裂：碰撞体立刻撤掉，冰块往下塌、向四周散开 0.45 s 后销毁。
    /// 不是名册敌人（TS 也不进阵容，只由狐巫生成）：不登记 EnemyDef、不进 <see cref="EnemyRegistry"/>（辅助怪的「同伴」自然不含它）。
    /// 外观：程序化的一排冰棱柱（中间高两端低），从地下 0.4 s 升起。
    /// </summary>
    public sealed class FoxIceWall : MonoBehaviour
    {
        public const float Width = 4f, Height = 2.5f, Thick = 0.6f, Life = 12f, BaseHp = 150f, RiseTime = 0.4f, CollapseTime = 0.45f;
        public const int Segments = 6;
        /// <summary>主人死后剩余寿命的范围（秒）</summary>
        public const float OrphanMin = 0.35f, OrphanMax = 0.6f;

        static readonly Color IceColor = Hex.Rgb(0xbfe8ff), IceGlow = Hex.Rgb(0x2f7fb8), HotColor = Hex.Rgb(0xffffff), FrostColor = Hex.Rgb(0x9fdcff);
        static readonly int BaseColorId = Shader.PropertyToID("_BaseColor"), EmissionId = Shader.PropertyToID("_EmissionColor");
        static Mesh columnMesh;
        static Material wallMaterial;

        readonly List<GameObject> segments = new();
        readonly List<Renderer> shards = new();
        MaterialPropertyBlock block;
        Transform model;
        float life = Life, age, collapse = -1, crack;
        bool hadOwner, ownerLost;

        /// <summary>立起这道墙的狐巫（可能已经死了）</summary>
        public FoxWitchAI Owner { get; private set; }
        public Damageable Health { get; private set; }
        /// <summary>还立着（没碎、没到期）</summary>
        public bool Alive => this && Health && !Health.Dead;
        /// <summary>立着的碰撞段数（测试 / 调试用）</summary>
        public int SegmentCount => segments.Count;
        /// <summary>剩余寿命（秒）</summary>
        public float Remaining => life;

        // ───────────── 纯计算（EditMode 测试直接调） ─────────────

        /// <summary>第 i 段碰撞盒的中心沿墙走向（根节点 +X）的偏移</summary>
        public static float SegmentCenter(int i) => (i + 0.5f) * (Width / Segments) - Width * 0.5f;

        /// <summary>
        /// 一个竖直胶囊（脚底在墙的局部坐标 localFeet、半径 r、高 h）和第 i 段重叠：
        /// 沿墙方向 |x − 段中心| &lt; 半段宽 + r，墙厚方向 |z| &lt; 半厚 + r，竖直方向 [脚底, 脚底 + h] 与 [0, 墙高] 相交
        /// </summary>
        public static bool SegmentOverlaps(Vector3 localFeet, int i, float r, float h)
        {
            float half = Width / Segments * 0.5f;
            return Mathf.Abs(localFeet.x - SegmentCenter(i)) < half + r && Mathf.Abs(localFeet.z) < Thick * 0.5f + r
                   && localFeet.y + h > 0 && localFeet.y < Height;
        }

        // ───────────── 生成 ─────────────

        /// <summary>在地面点 ground 立一道墙：yaw = 墙面朝向（弧度，atan2(dx, dz)，朝玩家）；level = 狐巫的强度倍率（墙的血量随它）</summary>
        public static FoxIceWall Raise(FoxWitchAI owner, Vector3 ground, float yaw, float level)
        {
            var go = new GameObject("狐巫冰壁");
            go.transform.SetPositionAndRotation(ground, Quaternion.Euler(0, yaw * Mathf.Rad2Deg, 0));
            var hp = go.AddComponent<Damageable>();
            hp.maxHealth = EnemyAI.RoundHp(BaseHp * Mathf.Max(0.5f, float.IsFinite(level) ? level : 1f));
            hp.displayName = "狐巫冰壁";
            hp.noReward = true;
            hp.ResetVitals();
            var w = go.AddComponent<FoxIceWall>();
            w.Init(owner, hp);
            return w;
        }

        void Init(FoxWitchAI owner, Damageable hp)
        {
            Owner = owner;
            hadOwner = owner;
            Health = hp;
            hp.Damaged += OnDamaged;
            hp.Died += OnDied;
            block = new MaterialPropertyBlock();
            BuildModel();
            BuildSegments();
            var c = transform.position + Vector3.up * 0.1f;
            Fx.Ring(c, Width * 0.6f, FrostColor, 0.5f);
            // FX3：墙脚一溜扬雪 + 冰碴，墙头一记星芒
            for (int i = -1; i <= 1; i++)
            {
                var p = c + transform.right * (i * Width * 0.35f);
                Fx.Play("FrostSnowPuff", p, Vector3.up, FrostKit.Snow, 1.2f);
                FrostKit.Shatter(p + Vector3.up * 0.3f, 0.6f, IceColor, 10, 4);
            }
            Fx.FrostGlint(c + Vector3.up * Height * 0.9f, 1.1f);
            CameraShake.Quake(c, 0.15f, 18f, 0.2f);
        }

        /// <summary>6 段碰撞盒（世界层，命中盒挡视线）+ 挖洞的导航障碍；和玩家 / 地面敌人重叠的段不立</summary>
        void BuildSegments()
        {
            var pv = PlayerVitals.Instance;
            var cc = pv ? pv.GetComponent<CharacterController>() : null;
            float seg = Width / Segments;
            var size = new Vector3(seg, Height, Thick);
            for (int i = 0; i < Segments; i++)
            {
                if (pv && !pv.Dead && SegmentOverlaps(transform.InverseTransformPoint(pv.transform.position), i, cc ? cc.radius : 0.35f, cc ? cc.height : 1.8f)) continue;
                if (EnemyInSegment(i)) continue;
                var go = new GameObject($"Wall Segment {i}") { layer = 0 };
                go.transform.SetParent(transform, false);
                go.transform.localPosition = new Vector3(SegmentCenter(i), Height * 0.5f, 0);
                var box = go.AddComponent<BoxCollider>();
                box.size = size;
                var hb = go.AddComponent<Hitbox>();
                hb.owner = Health;
                hb.blocksSight = true;
                var ob = go.AddComponent<NavMeshObstacle>();
                ob.shape = NavMeshObstacleShape.Box;
                ob.size = size;
                ob.carving = true;
                ob.carveOnlyStationary = false;
                segments.Add(go);
            }
        }

        bool EnemyInSegment(int i)
        {
            var live = EnemyRegistry.Live;
            for (int j = 0; j < live.Count; j++)
            {
                var e = live[j];
                if (!e || e.Dead || e is FlyingEnemyAI) continue;
                if (SegmentOverlaps(transform.InverseTransformPoint(e.transform.position), i, EnemyRegistry.BodyRadius(e) * 0.85f, 2f)) return true;
            }
            return false;
        }

        /// <summary>外观：一排冰棱柱（中间高、两端低，带一点随机），挂在会升起 / 塌下的 model 节点下</summary>
        void BuildModel()
        {
            model = new GameObject("Model").transform;
            model.SetParent(transform, false);
            int n = Mathf.Max(4, Mathf.RoundToInt(Width / 0.55f));
            var rnd = new System.Random(7);
            float R() => (float)rnd.NextDouble();
            for (int i = 0; i < n; i++)
            {
                float u = (i + 0.5f) / n;
                float h = Height * (0.72f + 0.28f * Mathf.Sin(Mathf.PI * u)) * (0.9f + 0.2f * R());
                float r = Width / n * (0.62f + 0.2f * R());
                var go = new GameObject("Ice Column");
                go.transform.SetParent(model, false);
                go.transform.localPosition = new Vector3((u - 0.5f) * Width, 0, (R() - 0.5f) * Thick * 0.25f);
                go.transform.localRotation = Quaternion.Euler(0, R() * 180f, (R() - 0.5f) * 0.18f * Mathf.Rad2Deg);
                go.transform.localScale = new Vector3(r, h, Thick * 0.5f * (0.85f + 0.3f * R()));
                go.AddComponent<MeshFilter>().sharedMesh = Column;
                var mr = go.AddComponent<MeshRenderer>();
                mr.sharedMaterial = Material;
                mr.shadowCastingMode = ShadowCastingMode.On;
                shards.Add(mr);
            }
            model.localPosition = Vector3.down * Height;
            Tint(0);
        }

        void Update()
        {
            float dt = Time.deltaTime;
            age += dt;
            if (collapse >= 0)
            {
                // 碎裂：往下塌、向四周散开（缩小），很快消失
                collapse += dt;
                float t = Mathf.Clamp01(collapse / CollapseTime);
                model.localPosition = Vector3.down * (t * t * Height * 0.6f);
                model.localScale = new Vector3(1 + 0.3f * t, Mathf.Max(0.01f, 1 - t), 1 + 0.3f * t);
                if (t >= 1) Destroy(gameObject);
                return;
            }
            // 从地下升起（0.4 s，缓出）
            float rise = Mathf.Clamp01(age / RiseTime);
            rise = rise * rise * (3 - 2 * rise);
            model.localPosition = Vector3.down * ((1 - rise) * Height);
            life -= dt;
            // 主人死了：只在第一次发现时把剩余寿命缩到 0.35–0.6 s（错开几道墙的碎裂；每帧重掷会无限推迟）
            if (hadOwner && !ownerLost && (!Owner || Owner.Dead))
            {
                ownerLost = true;
                life = Mathf.Min(life, Random.Range(OrphanMin, OrphanMax));
            }
            float old = Mathf.Clamp01(1 - life / 2f);
            Tint(0.35f + 0.5f * crack + 0.4f * old * (0.5f + 0.5f * Mathf.Sin(age * 12f)));
            if (life <= 0) Expire();
        }

        void Tint(float glow)
        {
            block.SetColor(BaseColorId, Color.Lerp(IceColor, HotColor, crack * 0.4f));
            block.SetColor(EmissionId, IceGlow * (glow * 1.6f));
            foreach (var r in shards)
                if (r)
                    r.SetPropertyBlock(block);
        }

        void OnDamaged(DamageInfo info, DamageResult r)
        {
            if (Health.maxHealth > 0) crack = Mathf.Max(crack, 1 - Health.health / Health.maxHealth);
            if (r.total > 0 && Random.value < 0.5f) FrostKit.Shatter(info.point, 0.35f, IceColor, 6, 3);
        }

        /// <summary>到时 / 主人上限换墙：自己崩解（不经过伤害结算：没有击杀事件和掉落）</summary>
        public void Expire()
        {
            if (!Alive) return;
            Health.Kill(DamageInfo.Simple(0, DamageSource.Status, transform.position + Vector3.up * Height * 0.5f, Vector3.up));
        }

        void OnDied(DamageInfo info)
        {
            foreach (var s in segments)
                if (s)
                {
                    // 先停用：Destroy 要到帧末才生效，这一帧的射线 / 移动不该再被它挡住
                    s.SetActive(false);
                    Destroy(s);
                }
            segments.Clear();
            collapse = 0;
            if (EnemyRegistry.Purging) return;
            var c = transform.position + Vector3.up * Height * 0.5f;
            // FX3：整面墙沿宽度碎成三蓬大冰块 + 霜气
            for (int i = -1; i <= 1; i++) FrostKit.Shatter(c + transform.right * (i * Width * 0.33f), 1.3f, IceColor, 24, 6);
            FrostKit.Vapour(c, 1.6f, 8, FrostKit.Mist);
            GameAudio.PlayAt("shield_break", c, 0.8f, 1.1f);
        }

        void OnDestroy()
        {
            if (Health)
            {
                Health.Damaged -= OnDamaged;
                Health.Died -= OnDied;
            }
        }

        /// <summary>冰棱柱：底面在 y = 0 的六棱柱（半径 1），0.8 处收成尖顶到 y = 1，全场共用</summary>
        static Mesh Column
        {
            get
            {
                if (columnMesh) return columnMesh;
                const int sides = 6;
                var rings = new[] { (1f, 0f), (0.78f, 0.82f), (0f, 1f) };
                var v = new List<Vector3>();
                var tri = new List<int>();
                for (int k = 0; k < rings.Length - 1; k++)
                for (int i = 0; i < sides; i++)
                {
                    float a0 = i / (float)sides * Mathf.PI * 2f, a1 = (i + 1) / (float)sides * Mathf.PI * 2f;
                    var (y0, r0) = rings[k];
                    var (y1, r1) = rings[k + 1];
                    int b = v.Count;
                    v.Add(new Vector3(Mathf.Sin(a0) * r0, y0, Mathf.Cos(a0) * r0));
                    v.Add(new Vector3(Mathf.Sin(a1) * r0, y0, Mathf.Cos(a1) * r0));
                    v.Add(new Vector3(Mathf.Sin(a0) * r1, y1, Mathf.Cos(a0) * r1));
                    v.Add(new Vector3(Mathf.Sin(a1) * r1, y1, Mathf.Cos(a1) * r1));
                    // 下 a0 → 下 a1 → 上 为正面（同 SpikeField 的六棱锥）
                    tri.Add(b + 2);
                    tri.Add(b + 3);
                    tri.Add(b);
                    tri.Add(b + 3);
                    tri.Add(b + 1);
                    tri.Add(b);
                }
                columnMesh = new Mesh { name = "Ice Wall Column" };
                columnMesh.SetVertices(v);
                columnMesh.SetTriangles(tri, 0);
                columnMesh.RecalculateNormals();
                columnMesh.RecalculateBounds();
                return columnMesh;
            }
        }

        static Material Material
        {
            get
            {
                if (wallMaterial) return wallMaterial;
                wallMaterial = new Material(Shader.Find("Universal Render Pipeline/Lit")) { name = "Fox Ice Wall (runtime)" };
                wallMaterial.SetFloat("_Smoothness", 0.85f);
                wallMaterial.EnableKeyword("_EMISSION");
                return wallMaterial;
            }
        }
    }
}
