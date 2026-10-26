using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>出生法阵的章节主题：无（通用法阵）/ 沙（第一章）/ 冰（第二章）/ 火（第三章）</summary>
    public enum SpawnTheme
    {
        None,
        Sand,
        Frost,
        Fire,
    }

    /// <summary>
    /// 各章主题出生法阵（特效打磨 C 路）。通用的显形流程（溶解、光墙、螺旋光点、SpawnFinale）在 <see cref="SpawnMaterialize"/>（B 路），
    /// 这里只负责「这一章长什么样」：脚下的主题法阵贴花 + 本章的开场粒子、显形过程里的地表卷尘、显形完成那一下的余韵。
    /// 接口约定（SpawnMaterialize 调用）：
    ///   <see cref="For"/> 选主题；<see cref="Begin"/> 返回 true = 主题法阵已经画了，通用 FxDecals.Rune 不再画；
    ///   <see cref="Tick"/> 返回 true = 本章已经出了地表卷尘，通用沙旋跳过；<see cref="Finale"/> 叠加在 SpawnFinale 之后。
    /// 主题选择：敌人所在场景名 L1_ / L2_ / L3_ → 沙 / 冰 / 火；测试场等其它场景按敌人在图鉴里登记的章节；首领、附属单位、未登记 → None。
    /// </summary>
    public static class SpawnThemes
    {
        /// <summary>这只敌人用哪一章的法阵</summary>
        public static SpawnTheme For(EnemyAI ai)
        {
            if (!ai || ai is BossBrain) return SpawnTheme.None;
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
            _ => SpawnTheme.None,
        };

        /// <summary>
        /// 显形开始：在 ground 画本章主题法阵（半径 ringR、持续 duration 秒）并放本章的开场一下。
        /// 返回 true = 已经画了主题法阵（调用方不再画通用法阵）；None / 贴花不可用时返回 false
        /// </summary>
        public static bool Begin(SpawnTheme theme, Vector3 ground, float ringR, Color color, float duration, bool elite)
        {
            if (theme == SpawnTheme.None || !Fx.Finite(ground) || !(ringR > 0)) return false;
            return false;
        }

        /// <summary>每帧（k = 显形进度 0..1）：本章的地表卷尘 / 雪旋 / 火星。返回 true = 已经出了卷尘，调用方跳过通用沙旋</summary>
        public static bool Tick(SpawnTheme theme, Vector3 ground, float ringR, float k, float dt, Color color)
        {
            return false;
        }

        /// <summary>显形完成那一刻（叠加在 SpawnFinale 之后）：本章的余韵</summary>
        public static void Finale(SpawnTheme theme, Vector3 center, float size, Color color)
        {
        }
    }
}
