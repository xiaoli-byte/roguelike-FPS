using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 鲲鹏（第二章首领，2-4 北冥冰台；Three.js src/enemies/bosses/KunPeng.ts，docs/unity-parity.md 3.9 / D3 / D5 / D23，docs/level-design/maps/2-4.md）。
    /// 《庄子》北冥之鱼，化而为鸟：两个形态各是一个模型，阶段转换时在冰雾里换模型（<see cref="BossPhaseDef.form"/>）。
    ///   一阶段 · 鲲（SK_Boss_Kun × 1.3，头和前半身探出冰窟，冰线以下不建模；模型原点 = 平切口，切口始终压在水面下，见 <see cref="KunPengBrain"/>）：
    ///     吞吸、猛砸 + 冰浪、潜袭（从玩家那一侧破冰而出）、吐冰；平时在冰窟里慢慢绕到玩家那一侧。75% 以下鲲怒：猛砸连掀两道冰浪、吐冰多一块、喘息 × 0.8。
    ///   转换（50%，4.6 s，第 1.55 s 换形）：鲲沉入冰窟，冰海炸开（整圈冰浪），冰雾最浓时换成鹏，鹏从雾里升空；护盾重凝六成，第一招扇翼狂风。
    ///   二阶段 · 鹏（SK_Boss_Peng × 1.15，飞行形态）：扇翼狂风、俯冲掠台（撞冰柱 / 祭台硬直 1.8 s）、羽刃雨、落台歇翼（主要输出窗口）。
    ///     25% 以下狂怒：俯冲连掠两次、羽刃 14 枚、喘息 0.7（= 阶段 0.9 × 狂怒 0.78）。
    ///   弱点：额头的鲛珠（两个形态都是 pearl 骨骼），猛砸趴台、落台歇翼、撞柱时发亮。不召小怪（同 Three.js）。
    ///   血条刻度（D23）：75%（鲲怒）、50%（化鹏）、25%（鹏狂怒）——Three.js 那张写死的表只画了 50%。
    ///   数值：Three.js 4000 生命 + 1200 护盾（× 难度）；2-4 的难度 2.28 下按模拟秒伤定档 8000 + 2400（<see cref="KunPengBalance"/>：章末参考秒伤约 70–120 s 的中段）。
    /// 美术缺失时的代理（4.11）：鲲 = 冰鲸 SK_Enemy_IceWhale × 3，鹏 = 三青鸟 SK_Enemy_Qingniao × 3.5；再没有就是按首领尺寸的占位胶囊。招式不变。
    /// 动作：E5 的采样片段（AC_SK_Boss_Kun / AC_SK_Boss_Peng：act_&lt;状态&gt; 触发，events.json 叠加表给出手时刻），
    /// 出手跟动画事件（<see cref="BossMove"/> 的 Cue），没有事件的代理模型按时间兜底。
    /// </summary>
    [Defs(20)]
    public sealed class KunPengDef : BossDef
    {
        public const string Id = "boss_kunpeng";
        public const string KunForm = "kun", PengForm = "peng";
        public const string KunPrefab = "SK_Boss_Kun", PengPrefab = "SK_Boss_Peng";
        public const string KunProxy = "SK_Enemy_IceWhale", PengProxy = "SK_Enemy_Qingniao";
        /// <summary>化鹏阈值（生命层比例）与两个生命刻度</summary>
        public const float SwapAt = 0.5f, FuryAt = 0.75f, RageAt = 0.25f;
        public const string FuryMark = "kun_fury", RageMark = "peng_rage";
        /// <summary>转换演出时长与换形时刻（Three.js transitionDuration 4.6，冰雾最浓的 1.55 s）</summary>
        public const float TransitionSeconds = 4.6f, TransitionSwap = 1.55f;
        /// <summary>2-4 的难度（D1：1 + 0.8 × 1 + 0.16 × 3）与定档（I3 按首领浸泡实测重定，见 <see cref="KunPengBalance"/>）</summary>
        public const float StageDifficulty = 2.28f;
        public const float TierHp = 16000f, TierShield = 4800f;

        public static readonly Color Warn = Hex.Rgb(0x7fd8ff), Ice = Hex.Rgb(0xd8f6ff), Pearl = Hex.Rgb(0x7ff0ff), Gust = Hex.Rgb(0xbfe9ff);

        // ───────────── 鲲（Three.js 常量，米）─────────────

        /// <summary>两个形态的模型缩放（美术按 8 米制作：鲲约 10.4 m 高，鹏约 9.2 m）</summary>
        public const float KunScale = 1.3f, PengScale = 1.15f;
        /// <summary>鲲露出水面时模型原点（平切口）在环台地面下多深、完全沉下去时多深（Three.js KUN_BASE_Y / KUN_SUNK_Y）</summary>
        public const float KunBaseY = -1f, KunSunkY = -14f;
        /// <summary>
        /// 平切口的范围（模型单位，往后 / 往前 / 两侧）与它最高点至少压在水面下多深（Three.js KUN_CUT_*）。
        /// 抬身 / 前扑时整只往下沉，切口不露出水面（<see cref="KunPengMath.CutCeiling"/>）
        /// </summary>
        public const float CutBack = 3f, CutFront = 2.8f, CutSide = 2.8f, CutMargin = 0.3f;
        /// <summary>Three.js 的海面在环台地面上 0.06 m：E5 片段里烘进去的平切口上限就是按它算的</summary>
        public const float TsWaterLevel = 0.06f;

        /// <summary>鲲身体中心离冰沿多远（往冰窟里收：头部刚好探到冰沿上方）</summary>
        public float kunInset = 4.6f;
        /// <summary>
        /// 鲲的角色胶囊半径（世界米）。Prefab 的胶囊按整个包围盒做（半径约 4 m）：待机时鲲仰着头、额头的鲛珠离身体轴心不到 1 m，
        /// 从正面瞄过去要先穿过约 3 m 的胶囊才碰到鲛珠，超出命中扫描「进身体胶囊后 1.5 m 内穿过弱点才算弱点」的窗口，只打得到身体
        /// （2-4 冒烟第一轮的不合格项）。收到 1.8 m 只包躯干，进胶囊到穿过鲛珠不到 1 m；猛砸趴台时鲛珠在胶囊外。
        /// 躯干以外由命中区补：头（kun_head，2 m）、颈（kun_neck，2.2 m），都在鲛珠后下方（同 Three.js「额珠露在受击球外」）
        /// </summary>
        public float kunBodyRadius = 1.8f;
        /// <summary>平时绕到玩家那一侧的角速度、转头角速度（度/秒）、朝向偏离冰窟外法线的上限（度）</summary>
        public float kunCircleRate = 6.875f, kunTurnRate = 68.75f, kunAimLimit = 51.57f;

        // ───────────── 鹏 ─────────────

        /// <summary>盘旋高度（离地，模型原点 = 双爪）；飞越冰窟上空时不低于 PengOverHole（Three.js PENG_HOVER / PENG_OVER_HOLE）</summary>
        public float pengHover = 13.5f, pengOverHole = 11.5f;
        /// <summary>绕冰窟盘旋的角速度（度/秒）、掉头间隔（秒）</summary>
        public float pengOrbitRate = 13.75f;
        public Vector2 pengOrbitFlip = new(5f, 9f);
        /// <summary>水平加速度（米/秒²，Three.js accel 22）、竖直速度上限 = 移速 × climb</summary>
        public float pengAccel = 22f, pengClimb = 1.5f;

        // ───────────── 吞吸 / 狂风的推拉（Three.js 每 0.18 s 一下 3.4 / 3.6 m/s）─────────────

        /// <summary>
        /// 每一下的冲量（米/秒）与间隔（秒）。Unity 的玩家运动里水平冲量 &gt; 3 m/s 会触发「被击退」的失控，连续 3 秒的吞吸会让人一直失控，
        /// 所以每下压到 2.95、间隔缩到 0.15 s——单位时间的拉力与 Three.js 相同（约 19 m/s²）
        /// </summary>
        public float pullImpulse = 2.95f, pullInterval = 0.15f;

        public KunPengDef()
        {
            id = Id;
            name = "鲲鹏";
            title = "北冥之鱼 · 化而为鸟";
            brain = typeof(KunPengBrain);
            vitals = new BossVitals(TierHp / StageDifficulty, TierShield / StageDifficulty);
            tiers.Add(new BossVitalsTier(StageDifficulty, new BossVitals(TierHp, TierShield)));
            damage = 14f;
            speed = 9f;
            element = Element.None;
            color = Hex.Rgb(0x7fe8ff);
            warnColor = Warn;
            radius = 3f;
            height = 8f;
            repeatWeight = 0.2f;
            phaseWait = 2f;
            // 元素眩晕不生效：鲲在冰窟里、鹏在空中，两个模型都没有受击状态；撞柱是脚本化硬直（Stagger）
            stunBetweenMoves = false;

            forms.Add(new BossFormDef
            {
                id = KunForm, name = "鲲", prefab = KunPrefab, scale = KunScale, proxyPrefab = KunProxy, proxyScale = 3f,
                weakBone = "pearl", weakRadius = 0.6f / KunScale,
            });
            forms.Add(new BossFormDef
            {
                id = PengForm, name = "鹏", prefab = PengPrefab, scale = PengScale, proxyPrefab = PengProxy, proxyScale = 3.5f,
                weakBone = "pearl", weakRadius = 0.5f / PengScale, flying = true, shieldRestore = 0.6f, firstMove = PengGust.MoveId,
            });
            phases.Add(new BossPhaseDef
            {
                at = SwapAt, form = PengForm, seconds = TransitionSeconds, formSwapAt = TransitionSwap, anim = "roar", sfx = "boss_roar", shake = 0.6f,
                toast = "鲲沉入冰窟——北冥要炸开了！", restScale = 0.9f,
            });
            marks.Add(new BossMark { at = FuryAt, id = FuryMark, tick = true });
            marks.Add(new BossMark { at = RageAt, id = RageMark, tick = true });
            // 额外命中区（设计尺寸，随体型放大；Three.js hitShapes 的世界半径 ÷ 体型）：鲲猛砸时头伸到冰沿外、超出根节点的角色胶囊；鹏的两翼
            hitZones.Add(new BossHitZoneDef { id = "kun_head", bone = "head", radius = 2f / KunScale, form = KunForm });
            hitZones.Add(new BossHitZoneDef { id = "kun_neck", bone = "spine_3", radius = 2.2f / KunScale, form = KunForm });
            hitZones.Add(new BossHitZoneDef { id = "peng_wing_l", bone = "wing_L_2", radius = 1.6f / PengScale, form = PengForm });
            hitZones.Add(new BossHitZoneDef { id = "peng_wing_r", bone = "wing_R_2", radius = 1.6f / PengScale, form = PengForm });

            moves.Add(() => new KunInhale());
            moves.Add(() => new KunSlam());
            moves.Add(() => new KunDive());
            moves.Add(() => new KunSpit());
            moves.Add(() => new PengGust());
            moves.Add(() => new PengSwoop());
            moves.Add(() => new PengFeatherRain());
            moves.Add(() => new PengPerch());

            // 鹏狂怒（25%）由 KunPengBrain 在鹏形态时触发（enrageBelow 留 0：鲲形态不狂怒）；阶段 0.9 × 0.78 ≈ Three.js 的 0.7
            enrageBelow = 0;
            enrageAfter = 0;
            enrageRestScale = 0.7f / 0.9f;
            enrageWindupScale = 1f;
            enrageDamageScale = 1f;
            enrageToast = "鹏狂怒了——俯冲会连掠两次，羽刃更密";
            summonCap = 0;

            intro.seconds = 3f;
            intro.anim = "rise";
            intro.sfx = null; // 吼声在升到一半时（KunPengBrain.IntroTick）
            intro.shake = 0;
            intro.firstRest = 1.2f;
            // 倒下演出放长到 4.4 s：鹏 55% 时砸到冰面、趴着挣两下再炸开；鲲沉到冰窟底才炸。之后冰面上留冻雾 / 霜斑几秒（KunPengDeath）
            defeat.seconds = 4.4f;
            defeat.despawnAfter = 2.5f;
            defeat.toast = null; // 按倒下时的形态说（KunPengBrain.OnDefeated）
        }
    }

    /// <summary>鲲鹏的纯几何（EditMode 测试直接测）：平切口的上限、角度差、缓动</summary>
    public static class KunPengMath
    {
        /// <summary>
        /// 鲲的模型原点（平切口中心）最高能放到多高（相对水面，米；Three.js kunCutCeiling）：前倾时切口后缘翘起、后仰时前缘翘起、侧倾时一侧翘起——
        /// 都要留在水面下 <see cref="KunPengDef.CutMargin"/>。pitch / roll 是弧度（绕 +X 正转 = 前倾），scale = 模型体型
        /// </summary>
        public static float CutCeiling(float pitch, float roll, float scale = KunPengDef.KunScale)
        {
            float sp = Mathf.Sin(pitch);
            float lift = scale * (Mathf.Max(Mathf.Max(KunPengDef.CutBack * sp, -KunPengDef.CutFront * sp), 0) + KunPengDef.CutSide * Mathf.Abs(Mathf.Sin(roll)));
            return -KunPengDef.CutMargin - lift;
        }

        /// <summary>平切口一圈的取样点（模型单位，XZ：往后 3、往前 2.8、两侧 2.8 与四个斜角；Three.js 回归测试的 rim）</summary>
        public static readonly Vector2[] CutRim =
        {
            new(0, -3f), new(0, 2.8f), new(2.8f, 0), new(-2.8f, 0), new(2f, -2f), new(-2f, -2f), new(2f, 2f), new(-2f, 2f),
        };

        /// <summary>t 在 [a, b] 里的比例（夹到 0..1；Three.js span）</summary>
        public static float Span(float t, float a, float b) => b > a ? Mathf.Clamp01((t - a) / (b - a)) : (t >= b ? 1 : 0);

        public static float EaseInOut(float t) => t < 0.5f ? 2 * t * t : 1 - Mathf.Pow(-2 * t + 2, 2) / 2;
        public static float EaseOutCubic(float t) => 1 - Mathf.Pow(1 - Mathf.Clamp01(t), 3);

        /// <summary>水平朝向（度，0 = +Z）</summary>
        public static float Yaw(Vector3 dir) => Mathf.Atan2(dir.x, dir.z) * Mathf.Rad2Deg;

        public static Vector3 Dir(float yawDeg)
        {
            float a = yawDeg * Mathf.Deg2Rad;
            return new Vector3(Mathf.Sin(a), 0, Mathf.Cos(a));
        }

        /// <summary>
        /// 俯冲掠台的路线（Three.js beginSwoopAim）：过玩家所在方位、离圆心 rp（夹在 冰窟 + 3 … 外缘 − 4）处，沿环台切线（side = ±1 决定往哪边掠），
        /// 半长 = min(16, √((外缘 − 3)² − rp²))，两端都留在环台内。返回起点、朝向（度）与全长
        /// </summary>
        public static (Vector3 from, float yaw, float length) SwoopLine(in IceHoleInfo hole, Vector3 player, int side)
        {
            float ra = hole.Angle(player), rp = hole.Distance(player);
            if (!(rp > 0.5f))
            {
                ra = 0;
                rp = hole.radius + 3f;
            }
            rp = Mathf.Clamp(rp, hole.radius + 3f, Mathf.Max(hole.radius + 3f, hole.outer - 4f));
            float tangent = ra + (side >= 0 ? 90f : -90f);
            float edge = hole.outer - 3f;
            float half = Mathf.Min(16f, Mathf.Sqrt(Mathf.Max(4f, edge * edge - rp * rp)));
            var mid = hole.Point(ra, rp);
            var from = mid - Dir(tangent) * half;
            return (from, tangent, half * 2f);
        }

        /// <summary>
        /// 俯冲从哪一头进场（<see cref="SwoopLine"/> 的 side）：鹏在玩家切线的哪一头，就从哪一头掠过来。
        /// 玩家把冰柱夹在自己和鹏之间，俯冲线就先穿过柱子（引撞）；鹏几乎在玩家正上方（沿切线不到 3 m）时用 fallback
        /// </summary>
        public static int SwoopSide(in IceHoleInfo hole, Vector3 player, Vector3 bird, int fallback)
        {
            float ra = hole.Distance(player) > 0.5f ? hole.Angle(player) : 0;
            var t = Dir(ra + 90f);
            float along = (bird.x - player.x) * t.x + (bird.z - player.z) * t.z;
            if (Mathf.Abs(along) < 3f) return fallback >= 0 ? 1 : -1;
            // side = +1 时起点在 −切线那一头
            return along < 0 ? 1 : -1;
        }

        /// <summary>
        /// 俯冲线上离起点 wallAt 米有一处陡面（冰柱、祭台侧壁、冰崖）时，线该多长。
        ///   · 陡面在玩家之前（wallAt ≤ playerAt）：不改。玩家躲在柱子后面，鹏会一头撞上去（引撞，硬直）。
        ///   · 陡面在玩家之后：截到陡面前 pullUp 米，鹏掠过玩家后提前拉起，不去撞玩家身后的柱子。
        ///     线至少要过玩家 past 米；离得太近截不出来时不截，交给撞柱判定。
        /// 没有陡面（wallAt ≥ length）时不改
        /// </summary>
        public static float TrimSwoop(float length, float playerAt, float wallAt, float pullUp, float past)
        {
            if (!(wallAt < length) || wallAt <= playerAt) return length;
            return Mathf.Min(length, Mathf.Max(wallAt - pullUp, playerAt + past));
        }

        /// <summary>这一趟是引撞：线上玩家之前就有陡面，鹏会先撞上它</summary>
        public static bool SwoopLured(float length, float playerAt, float wallAt) => wallAt < length && wallAt <= playerAt;
    }

    /// <summary>
    /// 鲲鹏的定档（docs/unity-parity.md 7.4「用模拟秒伤算击杀用时，落在 60–120 s」；I3 重定，docs/balance.md 第 3 节）：
    ///   章末参考秒伤（2-4，难度 2.28）= 首领浸泡实测（<see cref="BossBalance.Soak"/>：史诗 +2 裂风步枪 + 利刃 ×3 / 鹰目 ×2 / 屠巨 + 燎的技能，可选中时约 405）
    ///     × 0.8 命中率（鲲在冰窟里探头、鹏大半时间在 13.5 m 高空；躲招）≈ 324；
    ///   有效耐久 = 生命 + 护盾 + 化鹏时重凝的六成护盾（一阶段护盾先破，再打生命层到 50%）；
    ///   不可选中 = 登场 3 s + 转换 4.6 s + 一阶段的潜袭（每次约 1.5 s 在水下，一阶段约 3 次）。
    /// BS3 按「75 × 1.6 × 1.36 × 0.8 × 1.1 ≈ 144」定的 8000 + 2400 在实测秒伤下 35 s 就倒下（浸泡估算 42 s），I3 翻倍到 16000 + 4800：
    /// 模型约 85 s、浸泡估算约 78–83 s，±15% 秒伤都在 60–120 s 里
    /// </summary>
    public static class KunPengBalance
    {
        public const float HitRate = BossBalance.Uptime;
        public const float DivesPhase1 = 3, DiveUnderwater = 1.5f;

        /// <summary>章末参考秒伤（见类注释）</summary>
        public static float ReferenceDps => BossBalance.Dps("2-4") * HitRate;

        /// <summary>一场里不可选中的总秒数</summary>
        public static float UntargetableSeconds(BossDef def)
        {
            float transition = 0;
            foreach (var p in def.phases)
                if (p != null)
                    transition += p.seconds;
            return def.intro.seconds + transition + DivesPhase1 * DiveUnderwater;
        }

        /// <summary>有效耐久：三层合计 + 换形时重凝的护盾 / 护甲</summary>
        public static float EffectiveHp(BossDef def, float difficulty)
        {
            var v = def.VitalsAt(difficulty);
            float extra = 0;
            foreach (var f in def.forms)
                if (f != null)
                    extra += v.shield * Mathf.Clamp01(f.shieldRestore) + v.armor * Mathf.Clamp01(f.armorRestore);
            return v.Total + extra;
        }

        /// <summary>按秒伤 dps 打完一场的秒数（含不可选中）</summary>
        public static float KillSeconds(BossDef def, float difficulty, float dps) =>
            EffectiveHp(def, difficulty) / Mathf.Max(1f, dps) + UntargetableSeconds(def);
    }
}
