using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 战斗事件 → 特效（FX1 / FX2 的调用点总线；FxRuntime 建好时登记，进入 Play 时 GameEvents 清空后重新登记）：
    ///   EnemyDamaged：命中火花（同 Three.js Combat.damageEnemy 第 6 步）——持续伤害跳伤、处决、免疫不出；每帧最多 10 个；
    ///     颜色：有元素用元素色，否则按第一层（盾蓝 / 甲金 / 血肉用敌人自己的颜色），格挡偏白；暴击走暴击预设（星芒 + 金环 + 小星），
    ///     盾 / 甲走各自的变体（<see cref="Fx.EnemyHit(Vector3, Color, bool, DamageLayer, float)"/>）。碎刃（近战）自己出紫色火花，这里跳过。
    ///   EnemyShieldBroken / EnemyArmorBroken：破盾（六边形碎片）/ 破甲（甲片崩飞），按身体大小。
    ///   EnemySpawned：出生法阵 + 溶解显形（<see cref="SpawnMaterialize"/>），挂上死亡迸散 + 尸体溶解（<see cref="DeathDissolve"/>）；首领不挂（有自己的登场 / 倒下演出）。
    ///   EnemyKilled：没经过出生登记的敌人（场景里摆的、测试刷的）补挂死亡效果。
    ///   StatusApplied：给敌人挂上状态外观（<see cref="StatusFx"/>：身体着色 + 骨骼上的粒子）。
    /// 计数（<see cref="Sparks"/> 等）给冒烟测试核对。
    /// </summary>
    public static class FxDirector
    {
        public const int MaxSparksPerFrame = 10;

        static bool installed;
        static int sparkFrame = -1, sparksThisFrame;

        /// <summary>累计：命中火花 / 暴击火花 / 破盾 / 破甲 / 死亡迸散 / 出生显形 / 状态外观挂上</summary>
        public static int Sparks, CritSparks, Shatters, ArmorBreaks, Deaths, Spawns, StatusVisuals;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics()
        {
            installed = false;
            sparkFrame = -1;
            sparksThisFrame = 0;
            Sparks = CritSparks = Shatters = ArmorBreaks = Deaths = Spawns = StatusVisuals = 0;
        }

        internal static void Install()
        {
            if (installed) return;
            installed = true;
            GameEvents.EnemyDamaged += OnDamaged;
            GameEvents.EnemyShieldBroken += OnShieldBroken;
            GameEvents.EnemyArmorBroken += OnArmorBroken;
            GameEvents.EnemySpawned += OnSpawned;
            GameEvents.EnemyKilled += OnKilled;
            GameEvents.StatusApplied += OnStatus;
        }

        internal static void Uninstall()
        {
            if (!installed) return;
            installed = false;
            GameEvents.EnemyDamaged -= OnDamaged;
            GameEvents.EnemyShieldBroken -= OnShieldBroken;
            GameEvents.EnemyArmorBroken -= OnArmorBroken;
            GameEvents.EnemySpawned -= OnSpawned;
            GameEvents.EnemyKilled -= OnKilled;
            GameEvents.StatusApplied -= OnStatus;
        }

        // ───────────── 命中 ─────────────

        static void OnDamaged(in HitEvent e)
        {
            var d = e.enemy;
            var r = e.result;
            var info = e.info;
            if (!d || r.immune) return;
            // 碎刃的斩击（近战标签）自己出紫色火花
            if (DamageCalc.IsExecute(info) || DamageCalc.IsDot(info) || info.source == DamageSource.Melee || (info.tags & DamageTag.Melee) != 0) return;
            if (r.total <= 0 && !r.blocked) return;
            if (Time.frameCount != sparkFrame)
            {
                sparkFrame = Time.frameCount;
                sparksThisFrame = 0;
            }
            if (sparksThisFrame >= MaxSparksPerFrame) return;
            sparksThisFrame++;
            var layer = r.firstLayer;
            Color color;
            if (r.blocked)
            {
                color = new Color(0.86f, 0.9f, 0.96f);
                layer = DamageLayer.Armor;
            }
            else if (info.element != Element.None) color = Fx.ElementColor(info.element);
            else color = layer == DamageLayer.Health ? EnemyColor(d) : Fx.LayerColor(layer);
            var p = Fx.Finite(info.point) && info.point != Vector3.zero ? info.point : Body(d, out _);
            // 层火花 + 弱点一响 + 暴击重音（星芒偏到轮廓外、叠加有上限，Fx.Shot.cs）
            Fx.EnemyHitOn(d, p, color, r.crit, layer, info.weakpoint);
            Sparks++;
            if (r.crit) CritSparks++;
        }

        static void OnShieldBroken(Damageable d)
        {
            if (!d) return;
            var c = Body(d, out float radius);
            Fx.ShieldShatter(c, radius);
            Shatters++;
        }

        static void OnArmorBroken(Damageable d)
        {
            if (!d) return;
            var c = Body(d, out float radius);
            Fx.ArmorBreak(c, radius);
            ArmorBreaks++;
        }

        // ───────────── 出生 / 死亡 ─────────────

        static void OnSpawned(EnemyAI ai)
        {
            if (!ai || !ai.Health || ai.Health.IsBoss) return;
            DeathDissolve.Attach(ai.Health);
            if (SpawnMaterialize.Begin(ai)) Spawns++;
        }

        static void OnKilled(in KillEvent e)
        {
            var d = e.enemy;
            if (!d || d.IsBoss || d.GetComponent<DeathDissolve>()) return;
            var dd = DeathDissolve.Attach(d);
            if (dd) dd.TriggerNow();
        }

        internal static void CountDeath() => Deaths++;

        // ───────────── 状态 ─────────────

        static void OnStatus(Damageable d, StatusId id, int stacks)
        {
            if (!d || d.Dead) return;
            if (StatusFx.Ensure(d)) StatusVisuals++;
        }

        // ───────────── 工具 ─────────────

        /// <summary>敌人定义色（命中火花、死亡迸散、出生法阵）；没有定义 / 白色时用 Three.js 的默认敌人红</summary>
        public static Color EnemyColor(Damageable d)
        {
            var ai = d ? d.GetComponent<EnemyAI>() : null;
            var def = ai ? EnemyRoster.Get(ai.enemyId) : null;
            if (def == null) return Fx.HealthColor;
            var c = def.color;
            return c.r > 0.97f && c.g > 0.97f && c.b > 0.97f ? Fx.HealthColor : c;
        }

        /// <summary>身体中心与水平半径（角色胶囊的包围盒；没有碰撞体时按 1 m 高的人形估）</summary>
        public static Vector3 Body(Damageable d, out float radius)
        {
            var col = d.GetComponent<Collider>();
            if (col)
            {
                var b = col.bounds;
                radius = Mathf.Clamp(Mathf.Max(b.extents.x, b.extents.z), 0.3f, 3f);
                return b.center;
            }
            radius = 0.5f;
            return d.transform.position + Vector3.up;
        }
    }
}
