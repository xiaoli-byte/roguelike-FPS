using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>地火的外观变体（FX4，SF_FxDecal 模式 5 的 P.z）</summary>
    public enum FireBed
    {
        /// <summary>余烬：焦黑地面上发红的炭缝和火星（炭童的炭块地火、毕方的讹火、傩巫的喷火、火浣鼠余火）</summary>
        Ember = 0,
        /// <summary>纸灰：灰白的纸灰片，边缘还在烧（炮仗傀儡的火箭落点、神火飞鸦撞地）</summary>
        PaperAsh = 1,
        /// <summary>熔铜：流动的亮铜（熔铜匠泼的铜水）</summary>
        Molten = 2,
        /// <summary>熔岩溅：一摊摊熔岩，表面慢慢结黑壳（火鼍鼍鸣溅起的火点、熔炉铁牛的熔铁）</summary>
        Lava = 3,
        /// <summary>日火裂痕：沙地上断续的金白裂缝（镇墓兽冲锋犁出来的）</summary>
        Sunfire = 4,
    }

    /// <summary>
    /// 地火的外观（FX4「地火变体」；Three.js InfernoPackFx.spawnFloorFire / InfernoRangedFx.spawnEmberFire / InfernoSupportFx.spawnFirePool / InfernoBlastFx.spawnPaperAsh）：
    /// 一块按变体画的地火贴花（<see cref="FxDecals.Fire"/>：余烬 / 纸灰 / 熔铜 / 熔岩溅 / 日火裂痕，自己往上冒火星 / 熔滴）+ 一簇跳动的火舌
    /// （<see cref="FlameTongues.Ground"/>，熔铜 / 熔岩 / 日火的颜色各不同）。挂在 <see cref="FloorFire"/> 物体上：地火结束 / 被祸斗吃掉时
    /// 火舌 0.3 s 内缩没、贴花冷掉；伤害、登记给祸斗吃都归 FloorFire。
    /// </summary>
    public sealed class FloorFireFx : MonoBehaviour
    {
        HazardZone zone;
        FxHandle decal, flames;
        bool ended;

        public FireBed Bed { get; private set; }

        /// <summary>给 host（地火物体）挂外观：center = 地面点，radius / duration 同地火</summary>
        public static FloorFireFx Attach(GameObject host, Vector3 center, float radius, float duration, FireBed bed)
        {
            if (!host || !Application.isPlaying) return null;
            var f = host.AddComponent<FloorFireFx>();
            f.zone = host.GetComponent<HazardZone>();
            f.Bed = bed;
            float r = Mathf.Max(0.3f, radius);
            f.decal = FxDecals.Fire(center + Vector3.up * 0.02f, r * 1.05f, duration, bed);
            int n = Mathf.Clamp(Mathf.RoundToInt(2 + r * 2.2f), 2, 9);
            float size = Mathf.Clamp(0.35f + r * 0.25f, 0.35f, 0.9f);
            switch (bed)
            {
                case FireBed.Molten:
                    f.flames = FlameTongues.Ground(center, r * 0.7f, Mathf.Max(2, n - 2), duration, size * 0.8f, Hex.Rgb(0xfff0c0), Hex.Rgb(0xff9a30), Hex.Rgb(0xc8401a));
                    break;
                case FireBed.Lava:
                    f.flames = FlameTongues.Ground(center, r * 0.7f, Mathf.Max(2, n - 1), duration, size * 0.85f, Hex.Rgb(0xffe08a), Hex.Rgb(0xff7a1a), Hex.Rgb(0xb02a10));
                    break;
                case FireBed.Sunfire:
                    f.flames = FlameTongues.Ground(center, r * 0.75f, n, duration, size * 0.9f, Hex.Rgb(0xfff6d0), Hex.Rgb(0xffb040), Hex.Rgb(0xe0501a));
                    break;
                case FireBed.PaperAsh:
                    f.flames = FlameTongues.Ground(center, r * 0.8f, Mathf.Max(2, n - 1), duration, size * 0.7f);
                    break;
                default:
                    f.flames = FlameTongues.Ground(center, r * 0.75f, n, duration, size);
                    break;
            }
            return f;
        }

        void Update()
        {
            if (ended || !zone || !zone.Ended) return;
            ended = true;
            decal.Cancel();
            flames.Cancel();
        }

        void OnDestroy()
        {
            decal.Cancel();
            flames.Cancel();
        }
    }
}
