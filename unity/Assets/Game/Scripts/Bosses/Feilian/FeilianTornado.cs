using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 龙卷风柱（飞廉二阶段起；chuanzang-combat-v1.md 4.2 tornado）：从风涡落下、3.5 m/s 追人，碰到卷起来甩出去（8，网页值）；寿命 9 s。
    /// 火龙卷：被火打中（燎的燃爆雷 / 火元素的伤害打在柱身上）→ 变橙 8 s，不再追人，被风吸向飞廉（6 m/s），经过它 3.5 m 内每 0.5 s 烧它 40（换算）并挂灼烧。
    /// 柱身有一个竖直胶囊 + <see cref="Damageable"/>（不进敌人登记、不给奖励、血量不掉）：子弹 / 爆炸打在柱身上就能点火。外观 <see cref="FeilianSpiral"/>
    /// </summary>
    public sealed class FeilianTornado : MonoBehaviour
    {
        public const float Radius = 2.4f, Height = 12f, HitRadius = 2.4f, HitTick = 0.6f, WebDamage = 8f;

        FeilianBrain owner;
        FeilianSpiral look;
        Damageable hp;
        float life, fireLeft, tick;

        /// <summary>正在烧（火龙卷）</summary>
        public bool Burning => fireLeft > 0;
        public float Life => life;
        /// <summary>烧到飞廉几次、卷到玩家几次（测试用）</summary>
        public int BurnHits { get; private set; }
        public int PlayerHits { get; private set; }

        public static FeilianTornado Spawn(FeilianBrain owner, Vector3 at, float life)
        {
            var go = new GameObject("FeilianTornado") { layer = Layers.Character };
            if (owner && owner.gameObject.scene.IsValid()) UnityEngine.SceneManagement.SceneManager.MoveGameObjectToScene(go, owner.gameObject.scene);
            at.y = owner ? owner.GroundAt(at) : at.y;
            go.transform.position = at;
            var t = go.AddComponent<FeilianTornado>();
            t.owner = owner;
            t.life = life;
            t.Build();
            return t;
        }

        void Build()
        {
            var cap = gameObject.AddComponent<CapsuleCollider>();
            cap.radius = 1.4f;
            cap.height = Height * 0.7f;
            cap.center = Vector3.up * Height * 0.35f;
            var rb = gameObject.AddComponent<Rigidbody>();
            rb.isKinematic = true;
            rb.useGravity = false;
            hp = gameObject.AddComponent<Damageable>();
            hp.maxHealth = 1e6f;
            hp.ResetVitals();
            hp.noReward = true;
            hp.displayName = "龙卷风柱";
            hp.Damaged += OnDamaged;
            look = FeilianSpiral.Create(transform.position, Radius * 0.55f, Radius * 1.9f, Height, 280f, transform);
            Fx.FeilianSnowCrown(transform.position, 1.2f);
        }

        void OnDamaged(DamageInfo info, DamageResult r)
        {
            if (hp) hp.health = hp.maxHealth;
            if (info.element == Element.Fire || info.subElement == Element.Fire) Ignite();
        }

        /// <summary>点着：变火龙卷（已经在烧就续满）</summary>
        public void Ignite()
        {
            if (!owner || owner.Dead) return;
            var d = owner.Def as FeilianDef;
            bool first = fireLeft <= 0;
            fireLeft = d != null ? d.fireLife : 8f;
            life = Mathf.Max(life, fireLeft);
            if (look) look.SetFire(true);
            if (!first) return;
            Fx.FeilianIgnite(transform.position + Vector3.up * 3f);
            owner.Tell("feilian_fire", "火龙卷！风把它吸回飞廉那里", FeilianPalette.Fire, 8f, 2f);
            owner.FireTornadoes++;
        }

        /// <summary>立刻散掉（0.5 s 渐隐）</summary>
        public void Dissipate(float seconds = 0.5f) => life = Mathf.Min(life, seconds);

        void Update()
        {
            float dt = Time.deltaTime;
            life -= dt;
            tick -= dt;
            var d = owner ? owner.Def as FeilianDef : null;
            if (!owner || owner.Dead || life <= 0)
            {
                End();
                return;
            }
            Vector3 target;
            float speed;
            if (fireLeft > 0)
            {
                fireLeft -= dt;
                target = owner.transform.position;
                speed = d != null ? d.fireSpeed : 6f;
                if (fireLeft <= 0 && look) look.SetFire(false);
            }
            else
            {
                target = owner.PlayerPosition;
                speed = d != null ? d.tornadoSpeed : 3.5f;
            }
            var p = transform.position;
            var to = target - p;
            to.y = 0;
            float dist = to.magnitude;
            if (dist > 0.05f) p += to / dist * Mathf.Min(dist, speed * dt);
            if (owner.Arena) p = owner.Arena.Clamp(p, 1f);
            p.y = owner.GroundAt(p);
            transform.position = p;
            if (tick > 0) return;
            if (fireLeft > 0)
            {
                // 火龙卷烧飞廉
                if (Flat(owner.transform.position - p) < (d != null ? d.fireRadius : 3.5f))
                {
                    tick = d != null ? d.fireTick : 0.5f;
                    BurnHits++;
                    var info = new DamageInfo
                    {
                        amount = (d != null ? d.fireDamage : 40f) * owner.WebScale, element = Element.Fire, source = DamageSource.Environment, statusChance = 1f,
                        point = owner.BodyCenter, direction = (owner.BodyCenter - p).normalized, instigator = this,
                    };
                    Combat.DamageEnemy(owner.Health, info);
                    Fx.FeilianIgnite(owner.BodyCenter);
                }
                return;
            }
            // 卷到玩家：甩出去
            if (!LordBrain.PlayerFeet(out var feet) || LordBrain.PlayerDashing) return;
            if (Flat(feet - p) > HitRadius || feet.y > p.y + Height * 0.6f) return;
            tick = HitTick;
            var hz = BossHazards.For(owner);
            float dmg = owner.MoveDamage(WebDamage / Mathf.Max(1f, owner.Def.damage));
            if (hz.Hurt(dmg, Element.None, p) > 0) PlayerHits++;
            var side = Vector3.Cross(Vector3.up, feet - p).normalized;
            LordBrain.PushPlayer(side * 5f + (feet - p).normalized * 2f + Vector3.up * 7f);
        }

        static float Flat(Vector3 v)
        {
            v.y = 0;
            return v.magnitude;
        }

        void End()
        {
            if (hp) hp.Damaged -= OnDamaged;
            if (look)
            {
                look.transform.SetParent(null, true);
                look.FadeOut(0.5f);
                look = null;
            }
            Destroy(gameObject);
        }

        void OnDestroy()
        {
            if (look) Destroy(look.gameObject);
            if (owner) owner.Forget(this);
        }
    }
}
