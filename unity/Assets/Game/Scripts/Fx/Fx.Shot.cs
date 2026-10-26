using Spiritfire.Art;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 射击核心的特效入口（特效打磨 A 路）：
    ///   枪口火焰的样式（<see cref="MuzzleStyleOf"/>，每类枪各有形状，见 <see cref="MuzzleFlashes"/>）、抛壳的弹壳种类（<see cref="ShellOf"/>，见 <see cref="ShellCasings"/>）；
    ///   命中反馈 <see cref="EnemyHitOn"/>：盾 / 甲 / 血肉三层各自的火花 + 弱点额外一响（<c>EnemyHitWeak</c>）+ 暴击重音（<see cref="CritHit"/>）；
    ///   暴击：火花在命中点，星芒偏到身体轮廓外侧（命中点那一侧、朝镜头挪一点），尺寸收敛，连续暴击时星芒有上限（0.22 s 内最多 2 个、第 2 个缩小，再多只出小金星），
    ///   隔一会儿的第一个暴击额外一圈金环 + 一闪灯——重音清楚，敌人轮廓始终看得见；
    ///   第一人称换算 <see cref="ViewmodelToMain"/>：枪模相机里的一点 → 主相机里同一屏幕位置的世界点（抛壳口、弩的枪口）。
    /// </summary>
    public static partial class Fx
    {
        // ───────────── 枪口 / 抛壳 ─────────────

        /// <summary>武器 → 枪口火焰样式（先按 id，认不出的按武器大类）</summary>
        public static MuzzleStyle MuzzleStyleOf(WeaponDef def)
        {
            if (def == null) return MuzzleStyle.Rifle;
            switch (def.id)
            {
                case "smg": return MuzzleStyle.Smg;
                case "rifle":
                case "burst": return MuzzleStyle.Rifle;
                case "minigun": return MuzzleStyle.Minigun;
                case "shotgun":
                case "magmashot": return MuzzleStyle.Shotgun;
                case "sniper": return MuzzleStyle.Sniper;
                case "railgun": return MuzzleStyle.Railgun;
                case "revolver":
                case "trinity": return MuzzleStyle.Revolver;
                case "beam":
                case "stormpod":
                case "lantern": return MuzzleStyle.Energy;
                case "flamer": return MuzzleStyle.Flamer;
                case "launcher": return MuzzleStyle.Launcher;
                case "swarm": return MuzzleStyle.Rocket;
                case "crossbow": return MuzzleStyle.Crossbow;
            }
            return def.kind switch
            {
                WeaponKind.Pistol => MuzzleStyle.Revolver,
                WeaponKind.Smg => MuzzleStyle.Smg,
                WeaponKind.Shotgun => MuzzleStyle.Shotgun,
                WeaponKind.Sniper => MuzzleStyle.Sniper,
                WeaponKind.Launcher => MuzzleStyle.Launcher,
                WeaponKind.Beam => MuzzleStyle.Energy,
                WeaponKind.Crossbow => MuzzleStyle.Crossbow,
                WeaponKind.Blade => MuzzleStyle.None,
                _ => MuzzleStyle.Rifle,
            };
        }

        /// <summary>开枪时抛出的弹壳（能量类、弓弩、发射器、喷火、转轮 / 折开换弹的不抛）</summary>
        public static ShellKind ShellOf(WeaponDef def)
        {
            if (def == null) return ShellKind.None;
            return def.id switch
            {
                "smg" => ShellKind.Pistol,
                "rifle" or "burst" or "minigun" => ShellKind.Rifle,
                "sniper" => ShellKind.Sniper,
                "shotgun" => ShellKind.Hull,
                _ => ShellKind.None,
            };
        }

        /// <summary>枪模相机的竖直视角（PlayerFactory.CreateCamera 同值）</summary>
        public const float ViewmodelFov = 60f;

        /// <summary>
        /// 枪模相机里的世界点 → 主相机前方 depth 米处、屏幕位置相同的世界点（两台相机同一位置、同一朝向，只是视角不同；同 WeaponController.Muzzle）。
        /// depth ≤ 0 时用这一点自己的深度
        /// </summary>
        public static Vector3 ViewmodelToMain(Camera main, Vector3 vmPoint, float depth = 0)
        {
            if (!main) return vmPoint;
            var cam = main.transform;
            var local = cam.InverseTransformPoint(vmPoint);
            float z = Mathf.Max(0.05f, local.z);
            float d = depth > 0 ? depth : z;
            float tanV = Mathf.Tan(ViewmodelFov * 0.5f * Mathf.Deg2Rad);
            float tanM = Mathf.Tan(Mathf.Clamp(main.fieldOfView, 10f, 170f) * 0.5f * Mathf.Deg2Rad);
            float k = d / z * (tanM / tanV);
            return cam.TransformPoint(new Vector3(local.x * k, local.y * k, d));
        }

        // ───────────── 命中 / 暴击 ─────────────

        /// <summary>暴击星芒的叠加窗口（秒）与窗口内的上限</summary>
        public const float CritWindow = 0.22f;
        public const int CritFlareCap = 2;

        static readonly float[] critTimes = new float[8];
        static int critHead;
        static float lastCritAccent = -10f;
        static int critSide = 1;

        /// <summary>累计：暴击星芒 / 被上限收掉的星芒 / 弱点命中（测试读）</summary>
        public static int CritFlares, CritFlaresCapped, WeakHits;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetShotStatics()
        {
            for (int i = 0; i < critTimes.Length; i++) critTimes[i] = -10f;
            critHead = 0;
            lastCritAccent = -10f;
            CritFlares = CritFlaresCapped = WeakHits = 0;
        }

        /// <summary>CritWindow 秒内已经出过几个暴击星芒</summary>
        static int RecentCrits(float now)
        {
            int n = 0;
            foreach (var t in critTimes)
                if (now - t < CritWindow)
                    n++;
            return n;
        }

        /// <summary>
        /// 打中敌人（FxDirector 按伤害事件调用）：层火花（盾 / 甲 / 血肉）+ 弱点一响 + 暴击重音。d 可为空（没有身体信息时星芒按镜头右侧偏）
        /// </summary>
        public static FxHandle EnemyHitOn(Damageable d, Vector3 point, Color color, bool crit, DamageLayer layer, bool weak, float scale = 1)
        {
            var h = layer switch
            {
                DamageLayer.Shield => Play("EnemyHitShield", point, Vector3.up, color, scale * (crit ? 0.8f : 1f)),
                DamageLayer.Armor => Play("EnemyHitArmor", point, Vector3.up, color, scale * (crit ? 0.8f : 1f)),
                _ => Play("EnemyHit", point, Vector3.up, color, scale),
            };
            if (weak)
            {
                WeakHits++;
                var cam = Camera.main;
                var toCam = cam ? (cam.transform.position - point).normalized : Vector3.up;
                Play("EnemyHitWeak", point, toCam, color, scale);
            }
            if (crit) CritHit(d, point, color, scale);
            return h;
        }

        /// <summary>
        /// 暴击重音：命中点一团金色火花（EnemyHitCrit），星芒（CritFlare）放到身体轮廓外侧；窗口内第 2、3 个依次缩小，超过上限只留小金星
        /// </summary>
        public static FxHandle CritHit(Damageable d, Vector3 point, Color color, float scale = 1)
        {
            if (!Finite(point)) return FxHandle.None;
            float now = Time.time;
            var h = Play("EnemyHitCrit", point, Vector3.up, color, scale);
            int recent = RecentCrits(now);
            var cam = Camera.main;
            var camPos = cam ? cam.transform.position : point + Vector3.back * 5;
            var toCam = (camPos - point).normalized;
            var right = cam ? cam.transform.right : Vector3.right;
            // 身体中心与半径：星芒放在命中点那一侧的轮廓外
            Vector3 center = point;
            float radius = 0.35f;
            if (d)
            {
                center = FxDirector.Body(d, out radius);
                var col = d.GetComponent<Collider>();
                if (col) radius = Mathf.Clamp(Mathf.Min(col.bounds.extents.x, col.bounds.extents.z), 0.2f, 2.5f);
            }
            var lateral = point - center;
            lateral -= toCam * Vector3.Dot(lateral, toCam);
            lateral.y *= 0.35f;
            if (lateral.sqrMagnitude < 0.01f)
            {
                critSide = -critSide;
                lateral = right * critSide;
            }
            lateral.Normalize();
            var at = new Vector3(center.x, point.y, center.z) + lateral * (radius + 0.22f) + toCam * Mathf.Min(0.6f, radius * 0.6f + 0.15f) + Vector3.up * 0.06f;
            if (recent >= CritFlareCap)
            {
                // 上限：只出一颗往外蹦的小金星，不再叠星芒
                CritFlaresCapped++;
                Play("CritPip", at, Vector3.up, CritGold, 1f);
                return h;
            }
            critTimes[critHead] = now;
            critHead = (critHead + 1) % critTimes.Length;
            CritFlares++;
            float k = recent == 0 ? 1f : 0.78f;
            Play("CritFlare", at, toCam, CritGold, scale * k);
            // 隔了一会儿的第一个暴击：再加一圈金环 + 一闪灯（重音）
            if (now - lastCritAccent > 0.6f)
            {
                lastCritAccent = now;
                Play("CritRing", at, toCam, CritGold, 1f);
                FxLightPool.Flash(at, CritGold, 3.5f, 3.5f, 0.07f);
            }
            return h;
        }

        /// <summary>暴击金</summary>
        public static readonly Color CritGold = Hex.Rgb(0xffd24a);
    }

    /// <summary>枪口火焰样式（形状见 <see cref="MuzzleFlashes"/>）</summary>
    public enum MuzzleStyle
    {
        None,
        /// <summary>冲锋枪：短促六芒 + 短火舌</summary>
        Smg,
        /// <summary>步枪 / 点射：十字星芒 + 中火舌</summary>
        Rifle,
        /// <summary>机炮：十字星芒 + 一道长火舌，转角跟着枪管转</summary>
        Minigun,
        /// <summary>霰弹：宽散射喷口 + 扇形火舌 + 火星</summary>
        Shotgun,
        /// <summary>狙击：长火舌 + 扩散的冲击环</summary>
        Sniper,
        /// <summary>灵炮：长火舌 + 冲击环 + 符环（虹紫）</summary>
        Railgun,
        /// <summary>左轮：粗短火团</summary>
        Revolver,
        /// <summary>能量 / 光束 / 蛊器：光圈 + 能量波纹，没有火</summary>
        Energy,
        /// <summary>喷火：引火的一小团火 + 短火舌（主体是 FlameCone 的火焰）</summary>
        Flamer,
        /// <summary>榴弹：八角爆星 + 火团 + 一团烟</summary>
        Launcher,
        /// <summary>飞弹：尾焰长火舌 + 烟</summary>
        Rocket,
        /// <summary>弩：弦响的一圈气浪，没有火、不打灯</summary>
        Crossbow,
    }

    /// <summary>弹壳种类</summary>
    public enum ShellKind
    {
        None,
        /// <summary>手枪弹（冲锋枪）</summary>
        Pistol,
        /// <summary>步枪弹</summary>
        Rifle,
        /// <summary>大口径（狙击）</summary>
        Sniper,
        /// <summary>霰弹壳（红色塑料 + 铜底）</summary>
        Hull,
    }
}
