using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>出生法阵的章节主题：无（通用法阵）/ 沙（第一章）/ 冰（第二章）/ 火（第三章）/ 雷（第四章）</summary>
    public enum SpawnTheme
    {
        None,
        Sand,
        Frost,
        Fire,
        Thunder,
    }

    /// <summary>
    /// 各章主题出生法阵（特效打磨 C 路）。通用的显形流程（溶解、光墙、螺旋光点、SpawnFinale）在 <see cref="SpawnMaterialize"/>（B 路），
    /// 这里只负责「这一章长什么样」：脚下的主题法阵贴花 + 本章的开场粒子、显形过程里的地表卷尘、显形完成那一下的余韵。
    /// 接口约定（SpawnMaterialize 调用）：
    ///   <see cref="For"/> 选主题；<see cref="Begin"/> 返回 true = 主题法阵已经画了，通用 FxDecals.Rune 不再画；
    ///   <see cref="Tick"/> 返回 true = 本章已经出了地表卷尘，通用沙旋跳过；<see cref="Finale"/> 叠加在 SpawnFinale 之后。
    /// 主题选择：敌人所在场景名 L1_ / L2_ / L3_ / L4_ → 沙 / 冰 / 火 / 雷；测试场等其它场景按敌人在图鉴里登记的章节；首领、附属单位、未登记 → None。
    /// 第四章「雷」（邪火紫红雷光，fx-style §2.2）：雷纹法阵（<see cref="SigilMode.Thunder"/>）+ 法阵亮起时一圈贴地短电弧、显形中紫红电火花往上窜、
    /// 显形完成时一道竖直的细落雷 + 高原灰褐尘环。
    /// </summary>
    public static class SpawnThemes
    {
        /// <summary>对照开关（性能开 / 关对照用）：true = 不画主题法阵，全部退回 B 路的通用法阵</summary>
        public static bool Off;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics() => Off = false;
        /// <summary>这只敌人用哪一章的法阵</summary>
        public static SpawnTheme For(EnemyAI ai)
        {
            if (Off || !ai || ai is BossBrain) return SpawnTheme.None;
            var byScene = OfScene(ai.gameObject.scene.name);
            if (byScene != SpawnTheme.None) return byScene;
            return OfChapter(CodexCatalog.Lore.Chapter(CodexCatalog.EnemyId(ai.enemyId)));
        }

        /// <summary>场景名 → 主题（关卡场景 L1_* / L2_* / L3_*；其它场景 None）</summary>
        public static SpawnTheme OfScene(string scene)
        {
            if (string.IsNullOrEmpty(scene) || scene.Length < 3 || scene[0] != 'L' || scene[2] != '_') return SpawnTheme.None;
            return OfChapter(scene[1] - '0');
        }

        public static SpawnTheme OfChapter(int chapter) => chapter switch
        {
            1 => SpawnTheme.Sand,
            2 => SpawnTheme.Frost,
            3 => SpawnTheme.Fire,
            4 => SpawnTheme.Thunder,
            _ => SpawnTheme.None,
        };

        /// <summary>主题色：法阵贴花之外的粒子用（沙金 / 冰蓝 / 火橙）</summary>
        public static Color ThemeColor(SpawnTheme theme) => theme switch
        {
            SpawnTheme.Sand => SandGold,
            SpawnTheme.Frost => FrostPalette.Ice,
            SpawnTheme.Fire => InfernoPalette.Fire,
            SpawnTheme.Thunder => ThunderMain,
            _ => Fx.EnemyColor,
        };

        static readonly Color SandGold = Hex.Rgb(0xffb050), SandDust = Hex.Rgb(0xd2a66a);
        /// <summary>第四章：紫红主色 / 粉白亮芯 / 高原灰褐尘（fx-style §2.2）</summary>
        static readonly Color ThunderMain = Hex.Rgb(0xff4fd8), ThunderCore = Hex.Rgb(0xfff2fb), PlateauDust = Hex.Rgb(0x9a8a6c);
        static readonly Vector3[] arcWay = new Vector3[3];

        static SigilMode ModeOf(SpawnTheme theme) => theme switch
        {
            SpawnTheme.Sand => SigilMode.Sand,
            SpawnTheme.Frost => SigilMode.Frost,
            SpawnTheme.Thunder => SigilMode.Thunder,
            _ => SigilMode.Fire,
        };

        /// <summary>
        /// 显形开始：在 ground 画本章主题法阵（半径 ringR、持续 duration 秒）并放本章的开场一下。
        /// 返回 true = 已经画了主题法阵（调用方不再画通用法阵）；None / 贴花不可用时返回 false
        /// </summary>
        public static bool Begin(SpawnTheme theme, Vector3 ground, float ringR, Color color, float duration, bool elite)
        {
            if (theme == SpawnTheme.None || !Fx.Finite(ground) || !(ringR > 0)) return false;
            if (!SigilDecals.Place(ModeOf(theme), ground + Vector3.up * 0.02f, ringR * 1.15f, Mathf.Max(0.3f, duration), elite ? 1f : 0f).Alive) return false;
            var rt = FxRuntime.Ensure();
            switch (theme)
            {
                case SpawnTheme.Sand:
                    // 法阵亮起时脚下的沙往外一掀
                    Fx.Ring(ground + Vector3.up * 0.05f, ringR * 1.2f, SandGold, 0.45f, false);
                    EmitRing(rt, "Grit", ground, ringR * 0.9f, Mathf.RoundToInt(14 * Fx.Density), 2.5f, 1.5f, 0.05f, 0.5f, SandDust);
                    break;
                case SpawnTheme.Frost:
                    Fx.Play("FrostSnowPuff", ground + Vector3.up * 0.1f, Vector3.up, FrostPalette.Snow, Mathf.Clamp(ringR * 0.8f, 0.5f, 3f));
                    Fx.Ring(ground + Vector3.up * 0.05f, ringR * 1.2f, FrostPalette.IceHot, 0.45f, false);
                    break;
                case SpawnTheme.Fire:
                    // 一圈小火苗沿法阵外缘窜起，显形完前熄掉
                    FlameTongues.Ground(ground, ringR * 0.95f, Mathf.Clamp(Mathf.RoundToInt(ringR * 4), 4, 9), duration, Mathf.Clamp(ringR * 0.28f, 0.3f, 0.7f));
                    Fx.Ring(ground + Vector3.up * 0.05f, ringR * 1.2f, InfernoPalette.Fire, 0.45f, false);
                    break;
                case SpawnTheme.Thunder:
                    // 法阵亮起：外缘三道贴地短电弧（沿圆周折一下）+ 紫红亮环
                    for (int i = 0; i < 3; i++) RimArc(ground, ringR * 1.05f, Random.value * Mathf.PI * 2);
                    Fx.Ring(ground + Vector3.up * 0.05f, ringR * 1.2f, ThunderMain, 0.45f, false);
                    break;
            }
            return true;
        }

        /// <summary>沿法阵外缘的一道贴地短电弧（从角度 a 起，弧长约 50°，中间往外折一下）</summary>
        static void RimArc(Vector3 ground, float r, float a)
        {
            float b = a + 0.45f, c = a + 0.9f;
            arcWay[0] = ground + new Vector3(Mathf.Cos(a) * r, 0.12f, Mathf.Sin(a) * r);
            arcWay[1] = ground + new Vector3(Mathf.Cos(b) * r * 1.12f, 0.2f, Mathf.Sin(b) * r * 1.12f);
            arcWay[2] = ground + new Vector3(Mathf.Cos(c) * r, 0.12f, Mathf.Sin(c) * r);
            Lightning.Chain(arcWay, 3, ThunderMain, 0.04f);
        }

        /// <summary>每帧（k = 显形进度 0..1）：本章的地表卷尘 / 雪旋 / 火星。返回 true = 已经出了卷尘，调用方跳过通用沙旋</summary>
        public static bool Tick(SpawnTheme theme, Vector3 ground, float ringR, float k, float dt, Color color)
        {
            if (theme == SpawnTheme.None || !Fx.Finite(ground) || !(dt > 0)) return false;
            var rt = FxRuntime.Ensure();
            if (!rt) return true;
            float scale = Mathf.Clamp(ringR / 1.35f, 1f, 2.5f) * Fx.Density;
            switch (theme)
            {
                case SpawnTheme.Sand:
                    // 沙旋：金沙粒贴地打转往上卷 + 尘团（前 75%）
                    if (k < 0.75f)
                    {
                        Swirl(rt, "Grit", ground, ringR, Count(12f * scale * dt), 3.2f, 1.2f, 2.6f, 0.07f, 0.12f, 0.45f, 0.7f, SandDust);
                        Swirl(rt, "ToonSmoke", ground, ringR, Count(4f * scale * dt), 2.6f, 0.4f, 1.0f, 0.5f, 0.75f, 0.45f, 0.65f, Hex.Rgb(0xe6c890));
                    }
                    break;
                case SpawnTheme.Frost:
                    // 雪旋：雪花螺旋往上飘 + 冰晶闪粒 + 贴地冷雾
                    if (k < 0.8f)
                    {
                        Swirl(rt, "Snow", ground, ringR, Count(9f * scale * dt), 2.4f, 1.0f, 2.4f, 0.12f, 0.18f, 0.6f, 0.9f, FrostPalette.Snow);
                        Swirl(rt, "Twinkle", ground, ringR, Count(4f * scale * dt), 1.6f, 1.5f, 3f, 0.14f, 0.2f, 0.45f, 0.7f, FrostPalette.IceHot);
                        Swirl(rt, "ToonSmoke", ground, ringR, Count(3f * scale * dt), 1.2f, 0.1f, 0.3f, 0.6f, 0.9f, 0.5f, 0.7f, Hex.Rgb(0xd6e6f4));
                    }
                    break;
                case SpawnTheme.Fire:
                    // 火星往上窜 + 法阵边上冒的火舌团
                    Swirl(rt, "Ember", ground, ringR, Count(10f * scale * dt), 1.8f, 2.0f, 4.2f, 0.1f, 0.16f, 0.5f, 0.8f, InfernoPalette.Ember);
                    if (k < 0.7f) Swirl(rt, "ToonFlame", ground, ringR, Count(4f * scale * dt), 0.8f, 0.6f, 1.4f, 0.45f, 0.7f, 0.35f, 0.5f, InfernoPalette.Fire);
                    break;
                case SpawnTheme.Thunder:
                    // 紫红电火花往上窜（短、快）+ 前 70% 贴地的高原灰褐尘；偶尔外缘再噼啪一下
                    Swirl(rt, "StreakLight", ground, ringR, Count(8f * scale * dt), 1.4f, 2.5f, 5f, 0.03f, 0.05f, 0.12f, 0.25f, ThunderMain);
                    if (k < 0.7f) Swirl(rt, "ToonSmoke", ground, ringR, Count(3f * scale * dt), 1.6f, 0.2f, 0.6f, 0.45f, 0.7f, 0.45f, 0.65f, PlateauDust);
                    if (Random.value < dt * 2.5f) RimArc(ground, ringR, Random.value * Mathf.PI * 2);
                    break;
            }
            return true;
        }

        /// <summary>显形完成那一刻（叠加在 SpawnFinale 之后）：本章的余韵</summary>
        public static void Finale(SpawnTheme theme, Vector3 center, float size, Color color)
        {
            if (theme == SpawnTheme.None || !Fx.Finite(center)) return;
            size = Mathf.Clamp(size, 0.5f, 6f);
            var rt = FxRuntime.Ensure();
            switch (theme)
            {
                case SpawnTheme.Sand:
                    // 一圈沙往外泼 + 几颗金色符文
                    EmitRing(rt, "Grit", center - Vector3.up * size * 0.4f, size * 0.4f, Mathf.RoundToInt(16 * Fx.Density), 4f, 1.2f, 0.04f, 0.6f, SandDust);
                    Fx.Play("Glyph", center, Vector3.up, SandGold, size * 0.4f);
                    break;
                case SpawnTheme.Frost:
                    Fx.FrostGlint(center, Mathf.Clamp(size * 0.7f, 0.5f, 2.5f));
                    EmitRing(rt, "ShardIce", center, size * 0.35f, Mathf.RoundToInt(10 * Fx.Density), 3.5f, 1.5f, 0.05f, 0.6f, FrostPalette.Shard);
                    break;
                case SpawnTheme.Fire:
                    Fx.Play("Ember", center, Vector3.up, InfernoPalette.Fire, size * 0.5f);
                    EmitRing(rt, "Cinder", center, size * 0.35f, Mathf.RoundToInt(10 * Fx.Density), 3.5f, 1.8f, 0.06f, 0.8f, InfernoPalette.Ember);
                    break;
                case SpawnTheme.Thunder:
                    // 一道竖直的细落雷劈在身上（亮芯第一帧到顶）+ 高原灰褐尘环往外泼
                    Lightning.Spawn(center + Vector3.up * (size * 2.2f + 3f), center, ThunderCore, 0.06f);
                    EmitRing(rt, "ToonSmoke", center - Vector3.up * size * 0.4f, size * 0.45f, Mathf.RoundToInt(8 * Fx.Density), 2.6f, 0.6f, 0.5f, 0.6f, PlateauDust);
                    break;
            }
        }

        // ───────────── 发射小工具（无状态：按期望数量取整 + 余数按概率） ─────────────

        static int Count(float expected)
        {
            int n = Mathf.FloorToInt(expected);
            if (Random.value < expected - n) n++;
            return n;
        }

        /// <summary>从法阵边缘一圈里螺旋往上卷（切向 + 往里 + 往上）</summary>
        static void Swirl(FxRuntime rt, string style, Vector3 ground, float ringR, int n, float tangential, float upMin, float upMax, float sizeMin, float sizeMax,
            float lifeMin, float lifeMax, Color color)
        {
            if (!rt || n <= 0) return;
            n = FxBudget.Allow(n, false);
            if (n <= 0) return;
            var e = rt.GetEmitter(style);
            if (e == null) return;
            for (int i = 0; i < n; i++)
            {
                float a = Random.value * Mathf.PI * 2;
                float rr = Random.Range(0.55f, 1f) * ringR;
                var p = ground + new Vector3(Mathf.Cos(a) * rr, 0.08f, Mathf.Sin(a) * rr);
                var v = new Vector3(-Mathf.Sin(a) * tangential - Mathf.Cos(a) * 0.7f, Random.Range(upMin, upMax), Mathf.Cos(a) * tangential - Mathf.Sin(a) * 0.7f);
                var c = color * Random.Range(0.85f, 1.1f);
                c.a = 1;
                rt.EmitOne(e, p, v, Random.Range(sizeMin, sizeMax), Random.Range(lifeMin, lifeMax), c, 0);
            }
        }

        /// <summary>从 center 周围一圈往外 + 往上泼</summary>
        static void EmitRing(FxRuntime rt, string style, Vector3 center, float radius, int n, float speed, float up, float size, float life, Color color)
        {
            if (!rt || n <= 0) return;
            n = FxBudget.Allow(n, false);
            if (n <= 0) return;
            var e = rt.GetEmitter(style);
            if (e == null) return;
            for (int i = 0; i < n; i++)
            {
                float a = (i + Random.value * 0.6f) / n * Mathf.PI * 2;
                var dir = new Vector3(Mathf.Cos(a), 0, Mathf.Sin(a));
                var p = center + dir * radius * Random.Range(0.7f, 1f) + Vector3.up * 0.05f;
                var v = dir * speed * Random.Range(0.7f, 1.2f) + Vector3.up * up * Random.Range(0.6f, 1.3f);
                var c = color * Random.Range(0.85f, 1.1f);
                c.a = 1;
                rt.EmitOne(e, p, v, size * Random.Range(0.8f, 1.6f), life * Random.Range(0.8f, 1.3f), c, 0);
            }
        }
    }
}
