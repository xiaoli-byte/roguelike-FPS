using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 英雄基础属性（Three.js 版 src/player/Heroes.ts 的 base），在 PlayerVitals 之前把属性表建好。
    /// 燎（fox）：生命 100、护盾 60、移速 7.8。
    /// </summary>
    [DefaultExecutionOrder(-50)]
    public sealed class HeroStats : MonoBehaviour
    {
        public string heroId = "fox";
        public float maxHp = 100, maxShield = 50, moveSpeed = 7.5f;

        public void Configure(string id, float hp, float sh, float speed)
        {
            heroId = id;
            maxHp = hp;
            maxShield = sh;
            moveSpeed = speed;
        }

        void Awake()
        {
            var stats = StatSheet.Default();
            stats.SetBase(Stat.MaxHp, maxHp);
            stats.SetBase(Stat.MaxShield, maxShield);
            stats.SetBase(Stat.MoveSpeed, moveSpeed);
            var vitals = GetComponent<PlayerVitals>();
            if (vitals) vitals.stats = stats;
        }
    }
}
