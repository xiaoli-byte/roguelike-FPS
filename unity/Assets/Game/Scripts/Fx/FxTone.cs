using UnityEngine;
using UnityEngine.SceneManagement;

namespace Spiritfire.Game
{
    /// <summary>
    /// 特效的章节环境色（docs/art/fx-style.md §2.2「章节底色」）：烟、尘、碎屑、焦土这类「环境色」按章节换调子，和场景的调色一致——
    ///   第一章 · 沙寺：暖砂岩、赭石。定义里写的就是这一章的颜色（暖沙色，不用灰），原样用；
    ///   第二章 · 霜山：同样的明暗换成蓝灰 → 冷白（雪雾偏冷白，最亮也压在纯白以下，不糊屏）；
    ///   第三章 · 熔火：同样的明暗换成紫褐（玄武岩的暗紫，烟偏紫褐），整体压暗一档；
    ///   第四章 · 雪域：同样的明暗换成高原的灰褐（石块暗灰 → 尘 #9a8a6c，不用沙黄）。
    /// 用法：特效层写 <see cref="FxColor.Ground"/>、fixedColor 写沙寺的颜色，发射时按当前章节换（<see cref="Ground(Color)"/>）。
    /// 章节：当前场景名 L1_ / L2_ / L3_ / L4_ → 1 / 2 / 3 / 4；其它场景（测试场、主菜单）按本局章节，没有本局就当第一章。
    /// </summary>
    public static class FxTone
    {
        /// <summary>截图 / 测试用：强制按某一章调色（0 = 不强制）</summary>
        public static int Override;

        static int cachedFrame = -1, cached = 1;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics()
        {
            Override = 0;
            cachedFrame = -1;
            cached = 1;
        }

        /// <summary>当前章节（1 沙寺 / 2 霜山 / 3 熔火；其它章节按第一章的调子）</summary>
        public static int Chapter
        {
            get
            {
                if (Override > 0) return Override;
                if (cachedFrame == Time.frameCount) return cached;
                cachedFrame = Time.frameCount;
                cached = Detect();
                return cached;
            }
        }

        static int Detect()
        {
            var name = SceneManager.GetActiveScene().name;
            if (!string.IsNullOrEmpty(name) && name.Length >= 3 && name[0] == 'L' && name[2] == '_' && name[1] >= '1' && name[1] <= '9') return name[1] - '0';
            var run = RunState.Current;
            return run != null && run.chapter > 0 ? run.chapter : 1;
        }

        // 霜山：暗部蓝灰的石木 → 亮部冷白的雪雾；熔火：暗部暗紫玄武岩 → 亮部紫褐的烟（不发亮）
        static readonly Color FrostDark = new(0.27f, 0.33f, 0.43f), FrostLight = new(0.84f, 0.9f, 0.96f);
        static readonly Color InfernoDark = new(0.14f, 0.09f, 0.12f), InfernoLight = new(0.5f, 0.38f, 0.44f);
        // 雪域：暗部石块暗灰（#6e665e 压暗）→ 亮部高原灰褐尘（#9a8a6c）
        static readonly Color PlateauDark = new(0.25f, 0.23f, 0.21f), PlateauLight = new(0.6f, 0.54f, 0.42f);

        /// <summary>沙寺的环境色 → 当前章节的同明暗环境色</summary>
        public static Color Ground(Color sand) => Ground(sand, Chapter);

        /// <summary>沙寺的环境色 → 指定章节的同明暗环境色（第一章和未知章节原样返回）</summary>
        public static Color Ground(Color sand, int chapter)
        {
            if (chapter != 2 && chapter != 3 && chapter != 4) return sand;
            float lum = sand.r * 0.3f + sand.g * 0.59f + sand.b * 0.11f;
            float t = Mathf.Clamp01((lum - 0.08f) / 0.7f);
            var c = chapter switch
            {
                2 => Color.Lerp(FrostDark, FrostLight, t),
                4 => Color.Lerp(PlateauDark, PlateauLight, t),
                _ => Color.Lerp(InfernoDark, InfernoLight, t),
            };
            c.a = sand.a;
            return c;
        }
    }
}
