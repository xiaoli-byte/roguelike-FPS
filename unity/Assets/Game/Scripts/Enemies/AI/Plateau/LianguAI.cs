using System;
using System.Collections.Generic;
using Spiritfire.Art;
using UnityEngine;
using Random = UnityEngine.Random;

namespace Spiritfire.Game
{
    /// <summary>
    /// 连鼓灵（第四章辅助；combat 3.6，设计单第 6 节）：夔鼓的碎片——六面鼓（第 0 面红鼓）绕雷心转，一根雷兽骨槌依次敲鼓。悬浮离地 3 m、不走导航。
    /// 组装：根节点是雷心（SM_EnemyPart_LianguCore；GameDatabase 还没登记时是占位体，雷心网格从挂件库里取），
    /// 鼓环 Ring 下六面 SM_EnemyPart_LianguDrum（半径 1.15 m），骨槌 SM_EnemyPart_LianguMallet 挂在雷心上方的 MalletPivot 下。
    ///   · 鼓点 <c>beat</c>（每 1.2 s 一拍，同伴在才敲）：骨槌按手 K 曲线（<see cref="LianguKeys"/>，art/source/characters/SM_EnemyPart_LianguCore/anim/liangu_anims.py）
    ///     抬 → 砸 → 弹，鼓面一闪、一道电弧连到受益的同伴：普通鼓给 15 m 内层数最少的同伴一层静电护盾（最多 3 层），红鼓给 15 m 内同伴加速 6 s。
    ///   · 惊雷 <c>clap</c>（被逼到 5 m 内）：六面鼓全亮、转得飞快 0.8 s → 7 m 冲击波推开，10 + 雷殛。
    ///   · 雷心弹 <c>orb</c>：同伴死光或鼓全碎，自己出来保持 12 m，每 1.8 s 一发（16 m/s、8 + 雷殛）。
    ///   · 鼓：每面 45（按血量口径缩放），命中球在鼓上；雷心在 3 面以上鼓还在时只吃 25%，少于 3 面 100%，鼓全碎后雷心落地滚、吃 200%。
    ///     雷心一直带电（常驻持有）。死时雷心裂开一道白光，剩下的鼓和骨槌掉到地上。
    /// </summary>
    public sealed class LianguAI : PlateauEnemyAI
    {
        public const float Hover = 3f, RingRadius = 1.15f, DrumHp = 45f, BuffRange = 15f, HasteSeconds = 6f;
        public const float ClapRange = 5f, ClapRadius = 7f, ClapDamage = 10f, OrbSpeed = 16f, OrbDamage = 8f, OrbGap = 1.8f;
        public const int Drums = 6;

        public readonly float[] drumHp = new float[Drums];
        public int DrumsLeft
        {
            get
            {
                int n = 0;
                foreach (var h in drumHp)
                    if (h > 0)
                        n++;
                return n;
            }
        }
        public bool Dropped { get; private set; }
        public int Beats { get; private set; }
        public int ShieldsGiven { get; private set; }
        public int HastesGiven { get; private set; }
        public int BeatDrum { get; private set; }

        protected override bool Flies => true;

        Transform ring, malletPivot, mallet, coreModel;
        readonly Transform[] drums = new Transform[Drums];
        readonly HitZone[] drumZones = new HitZone[Drums];
        readonly float[] flash = new float[Drums];
        HitZone coreZone;
        IDisposable coreHold;
        float spin, orbCd, beatT = -1;
        bool built;

        protected override void Awake()
        {
            sight = 34f;
            centerY = 0f;
            base.Awake();
            Build();
            hp.Incoming.Add(DrumIncoming);
            for (int i = 0; i < Drums; i++) drumHp[i] = DrumHp;
        }

        public override void Spawn(float lvl, bool isElite)
        {
            base.Spawn(lvl, isElite);
            float s = HpScale(220f);
            for (int i = 0; i < Drums; i++) drumHp[i] = DrumHp * s;
            var p = transform.position;
            transform.position = new Vector3(p.x, Ground(p) + Hover, p.z);
            coreHold = Charge.Hold(hp, this);
        }

        // ───────────── 组装 ─────────────

        static GameObject Part(string name)
        {
            foreach (var a in EnemyCatalog.Attachments)
                if (a && a.name == name)
                    return a;
            return null;
        }

        static GameObject Spawn(string name, Transform parent)
        {
            var prefab = Part(name);
            GameObject go;
            if (prefab)
            {
                go = Instantiate(prefab, parent, false);
                go.name = name;
            }
            else
            {
                // 挂件库里没有（测试场、资产缺失）：灰色占位方块
                go = GameObject.CreatePrimitive(PrimitiveType.Cylinder);
                go.name = name + " (proxy)";
                go.transform.SetParent(parent, false);
                go.transform.localScale = Vector3.one * 0.45f;
            }
            foreach (var c in go.GetComponentsInChildren<Collider>(true)) Destroy(c);
            foreach (var x in go.GetComponentsInChildren<ArtAssetInfo>(true)) Destroy(x);
            return go;
        }

        void Build()
        {
            if (built) return;
            built = true;
            // 占位体：去掉胶囊和占位方块，雷心网格从挂件库里取
            var placeholder = GetComponent<PlaceholderBody>();
            if (placeholder)
            {
                foreach (Transform c in transform)
                    if (c.name is "Body" or "Facing" || c.GetComponent<Renderer>())
                        c.gameObject.SetActive(false);
                foreach (var c in GetComponents<Collider>()) c.enabled = false;
                coreModel = Spawn("SM_EnemyPart_LianguCore", transform).transform;
            }
            else coreModel = transform.Find("Model") ?? transform;
            body.SetWeakPointActive(false);
            // 雷心命中区
            var core = new GameObject("Zone_core");
            core.layer = Layers.Character;
            core.transform.SetParent(transform, false);
            var sc = core.AddComponent<SphereCollider>();
            sc.radius = 0.5f;
            var rb = core.AddComponent<Rigidbody>();
            rb.isKinematic = true;
            rb.useGravity = false;
            coreZone = HitZone.Create(sc, hp, body, "core", 1f, false, 1);
            // 鼓环
            ring = new GameObject("Ring").transform;
            ring.SetParent(transform, false);
            for (int i = 0; i < Drums; i++)
            {
                float a = i / (float)Drums * Mathf.PI * 2;
                var outDir = new Vector3(Mathf.Cos(a), 0, Mathf.Sin(a));
                var holder = new GameObject("Drum" + i).transform;
                holder.SetParent(ring, false);
                holder.localPosition = outDir * RingRadius;
                holder.localRotation = Quaternion.LookRotation(outDir) * Quaternion.Euler(90, 0, 0);
                var d = Spawn("SM_EnemyPart_LianguDrum", holder);
                if (i == 0)
                    foreach (var r in d.GetComponentsInChildren<Renderer>())
                    {
                        var mpb = new MaterialPropertyBlock();
                        r.GetPropertyBlock(mpb);
                        mpb.SetColor("_Tint", new Color(1f, 0.62f, 0.56f, 1f));
                        r.SetPropertyBlock(mpb);
                    }
                drums[i] = holder;
                var zgo = new GameObject("Zone_drum" + i);
                zgo.layer = Layers.Character;
                zgo.transform.SetParent(holder, false);
                var zs = zgo.AddComponent<SphereCollider>();
                zs.radius = 0.42f;
                var zr = zgo.AddComponent<Rigidbody>();
                zr.isKinematic = true;
                zr.useGravity = false;
                drumZones[i] = HitZone.Create(zs, hp, body, "drum" + i, 1f, false, 2);
            }
            // 骨槌：握柄在雷心上方，锤头朝外斜下
            malletPivot = new GameObject("MalletPivot").transform;
            malletPivot.SetParent(transform, false);
            malletPivot.localPosition = new Vector3(0, LianguKeys.PivotHeight, 0);
            mallet = Spawn("SM_EnemyPart_LianguMallet", malletPivot).transform;
        }

        float DrumIncoming(in IncomingHit h)
        {
            if (Dead) return 1;
            var info = h.info;
            var z = ZoneOf(info);
            for (int i = 0; i < Drums; i++)
                if (z == drumZones[i])
                {
                    if (drumHp[i] <= 0) return 0;
                    drumHp[i] -= h.amount;
                    flash[i] = 0.15f;
                    Fx.EnemyHit(info.point, PlateauPalette.DrumSkin, false, 0.8f);
                    if (drumHp[i] <= 0) BreakDrum(i);
                    return 0;
                }
            // 爆炸、反应、持续伤害：直接打雷心，也震附近的鼓
            if (!IsDot(info) && (IsBlast(info) || info.source == DamageSource.Status))
                for (int i = 0; i < Drums; i++)
                    if (drumHp[i] > 0 && drums[i] && Vector3.Distance(drums[i].position, info.point) < 3f)
                    {
                        drumHp[i] -= h.amount * 0.6f;
                        if (drumHp[i] <= 0) BreakDrum(i);
                    }
            int n = DrumsLeft;
            return n == 0 ? 2f : n < 3 ? 1f : 0.25f;
        }

        void BreakDrum(int i)
        {
            drumHp[i] = 0;
            var d = drums[i];
            if (!d) return;
            var at = d.position;
            d.gameObject.SetActive(false);
            Fx.Play("ToonBurst", at, Vector3.up, i == 0 ? PlateauPalette.Haste : PlateauPalette.DrumSkin, 1.2f);
            Fx.Burst(at, PlateauPalette.DrumWood, 10, 5f, 0.6f, 0.14f, 12);
            Fx.Play("Chunk", at, Vector3.up, PlateauPalette.DrumWood, 1f);
            GameUI.FloatText(at + Vector3.up * 0.5f, i == 0 ? "红鼓碎了" : $"鼓碎了（还剩 {DrumsLeft}）", i == 0 ? PlateauPalette.Haste : PlateauPalette.DrumSkin, 0.9f);
            if (DrumsLeft == 0 && !Dropped)
            {
                Dropped = true;
                InterruptAttack();
                GameUI.FloatText(Center + Vector3.up, "雷心掉下来了", PlateauPalette.Bolt, 1.1f);
            }
        }

        /// <summary>受益的同伴：同群活着的雷魅（以后领主召来的也算）</summary>
        readonly List<PlateauEnemyAI> mates = new();

        List<PlateauEnemyAI> Mates()
        {
            mates.Clear();
            if (Pack != null) mates.AddRange(Pack.Mates(this));
            mates.RemoveAll(m => m is LianguAI);
            return mates;
        }

        protected override void Roam(float dt)
        {
            var c = home;
            c.y = Ground(c) + Hover + 0.3f * Mathf.Sin(Time.time * 2f);
            FlyTowards(c, moveSpeed * 0.5f, dt);
            if (hp.health < hp.maxHealth) hp.Heal(hp.maxHealth * 0.3f * dt);
            if (vitals && !vitals.Dead && DistToPlayer < Sight && sees) Notice(true);
        }

        protected override void Fight(float dt, float dist)
        {
            var list = Mates();
            Vector3 c;
            if (list.Count == 0 || Dropped)
            {
                // 同伴都倒了（或者鼓全碎）：自己出来，保持 12 m 打雷心弹
                var away = transform.position - PlayerPos;
                away.y = 0;
                away = away.sqrMagnitude > 1e-3f ? away.normalized : Vector3.forward;
                c = PlayerPos + away * 12f;
            }
            else
            {
                // 躲在同伴群的后面 8 m
                c = Vector3.zero;
                foreach (var m in list) c += m.transform.position;
                c /= list.Count;
                var away = c - PlayerPos;
                away.y = 0;
                c += (away.sqrMagnitude > 1e-3f ? away.normalized : Vector3.forward) * 8f;
            }
            c.y = Ground(c) + (Dropped ? 0.5f : Hover + 0.3f * Mathf.Sin(Time.time * 2f));
            FlyTowards(c, moveSpeed * (Dropped ? 0.75f : 1f), dt, 3f);
            if (dist < ClapRange && cooldown <= 0 && !Dropped)
            {
                cooldown = PlateauMoves.LianguClap.cooldown;
                Begin(PlateauMoves.LianguClap);
                return;
            }
            if ((list.Count == 0 || Dropped) && dist < 35 && Time.time >= orbCd)
            {
                orbCd = Time.time + OrbGap;
                Begin(PlateauMoves.LianguOrb);
                return;
            }
            if (DrumsLeft > 0 && list.Count > 0 && !Dropped) Begin(PlateauMoves.LianguBeat);
        }

        protected override void MoveTick(float dt, MoveStage stage, float k)
        {
            // 敲鼓 / 惊雷 / 雷心弹的时候照样跟着同伴挪（悬着）
            var p = transform.position;
            float g = Ground(p) + (Dropped ? 0.5f : Hover);
            transform.position = new Vector3(p.x, Mathf.Lerp(p.y, g, Mathf.Min(1, dt * 3)), p.z);
        }

        protected override void OnMoveBegin(PlateauMove m)
        {
            if (m.id == "beat")
            {
                // 这一拍敲哪面：下一面还在的鼓
                int start = BeatDrum;
                for (int s = 1; s <= Drums; s++)
                {
                    int i = (start + s) % Drums;
                    if (drumHp[i] > 0)
                    {
                        BeatDrum = i;
                        break;
                    }
                }
                beatT = 0;
            }
        }

        protected override void OnMoveEvent(string id, string evt)
        {
            switch (id)
            {
                case "beat" when evt == "beat":
                    DoBeat();
                    break;
                case "clap" when evt == "warn":
                    Warn(Telegraph.Circle(new Vector3(transform.position.x, Ground(transform.position), transform.position.z), ClapRadius,
                        PlateauMoves.LianguClap.windup / HasteMult, TelegraphPalette.Danger));
                    break;
                case "clap" when evt == "hit":
                {
                    var g = new Vector3(transform.position.x, Ground(transform.position), transform.position.z);
                    Telegraph.Wave(g, ClapRadius, ClapRadius / 0.3f, TelegraphPalette.Danger, TelegraphTone.Danger);
                    Fx.PlateauArcRing(g, 1.2f, 10, 1.4f, 0.2f, 0.05f);
                    Fx.Play("ToonBurst", transform.position, Vector3.up, PlateauPalette.Core, 1.6f);
                    for (int i = 0; i < Drums; i++)
                        if (drumHp[i] > 0 && drums[i])
                            Fx.PlateauFaceFlash(drums[i].position, drums[i].up, 0.4f, PlateauPalette.Shield);
                    Quake(0.25f, 20f);
                    if (DistToPlayer < ClapRadius && !PlayerInvulnerable)
                        Strike(ClapDamage, transform.position, Element.Shock, PlateauGeo.Knock(PlayerPos, transform.position, 10f, 3f));
                    break;
                }
                case "orb" when evt == "release":
                {
                    var from = transform.position;
                    var spec = new EnemyProjectileSpec(from, (TargetChest - from).normalized * OrbSpeed, OrbDamage * DamageMult, 0.25f, 3.5f)
                    {
                        element = Element.Shock, visual = "orb", color = PlateauPalette.Shield, scale = 1.4f, source = this, blockable = true,
                        onImpact = (p, hitP) =>
                        {
                            if (!hitP) Fx.Play("ToonBurst", p, Vector3.up, PlateauPalette.Shield, 0.8f);
                        },
                    };
                    EnemyProjectile.Spawn(spec);
                    break;
                }
            }
        }

        /// <summary>骨槌砸下的那一下：普通鼓给一个同伴一层护盾，红鼓给周围同伴加速</summary>
        void DoBeat()
        {
            int i = BeatDrum;
            if (drumHp[i] <= 0 || !drums[i]) return;
            Beats++;
            flash[i] = 0.25f;
            var at = drums[i].position;
            bool red = i == 0;
            Fx.PlateauFaceFlash(at, drums[i].up, 0.5f, red ? PlateauPalette.Haste : PlateauPalette.Shield);
            var list = Mates().FindAll(m => Vector3.Distance(m.transform.position, transform.position) < BuffRange);
            if (red)
            {
                foreach (var m in list)
                {
                    m.Haste(HasteSeconds, this);
                    HastesGiven++;
                    Fx.PlateauBolt(at, m.Center, 0.05f, 0.25f, 0);
                    Fx.Play("ToonRing", m.transform.position + Vector3.up * 0.05f, Vector3.up, PlateauPalette.Haste, 1.4f);
                }
            }
            else
            {
                PlateauEnemyAI best = null;
                foreach (var m in list)
                    if (m.ShieldLayers < 3 && (!best || m.ShieldLayers < best.ShieldLayers))
                        best = m;
                if (best && best.AddShield())
                {
                    ShieldsGiven++;
                    Fx.PlateauBolt(at, best.Center, 0.05f, 0.25f, 0);
                }
            }
        }

        protected override void Update()
        {
            base.Update();
            if (Dead) return;
            float dt = Time.deltaTime;
            // 鼓环：平时慢转，惊雷前摇转得飞快；出手一下放大；硬直时整个鼓环倾斜
            float clap = Move.Id == "clap" && Move.Stage == MoveStage.Windup ? Move.StageK : 0;
            spin += dt * (1.4f + 6f * clap);
            float tilt = HitStaggered ? 20f * Mathf.Sin(Time.time * 9f) : 0f;
            ring.localRotation = Quaternion.Euler(tilt, -spin * Mathf.Rad2Deg, 0);
            float pop = Move.Id == "clap" && Move.Stage == MoveStage.Active ? 1.25f : 1f;
            // 骨槌：转到要敲的那面鼓，按手 K 曲线抬 → 砸 → 弹；鼓环被砸得一沉
            if (beatT >= 0) beatT += dt * HasteMult;
            if (Move.Id != "beat" && beatT > LianguKeys.Length) beatT = -1;
            float t = beatT >= 0 ? beatT : LianguKeys.Length;
            float a = BeatDrum / (float)Drums * Mathf.PI * 2 + spin;
            // 鼓 i 在鼓环里的方向是 (cos, sin)，鼓环绕 Y 转了 −spin 度：世界里是 (cos(a + spin), sin(a + spin))
            var outDir = new Vector3(Mathf.Cos(a), 0, Mathf.Sin(a));
            malletPivot.localRotation = Quaternion.LookRotation(outDir) * Quaternion.Euler(LianguKeys.Swing.Evaluate(t), 0, 0);
            malletPivot.localPosition = new Vector3(0, LianguKeys.PivotHeight + LianguKeys.PivotDip.Evaluate(t), 0);
            ring.localPosition = new Vector3(0, LianguKeys.RingDip.Evaluate(t), 0);
            ring.localScale = Vector3.one * pop;
            mallet.gameObject.SetActive(!Dropped);
            for (int i = 0; i < Drums; i++)
            {
                if (!drums[i] || !drums[i].gameObject.activeSelf) continue;
                flash[i] = Mathf.Max(0, flash[i] - dt);
                float s = 1f + LianguKeys.FacePop.Evaluate(i == BeatDrum ? t : LianguKeys.Length) + (flash[i] > 0 ? -0.08f : 0);
                drums[i].localScale = Vector3.one * s;
            }
            // 鼓全碎：雷心落地滚
            if (Dropped && coreModel) coreModel.Rotate(Vector3.right, dt * 170f, Space.Self);
        }

        protected override void OnDeath(DamageInfo info, PlateauDeath kind)
        {
            coreHold?.Dispose();
            coreHold = null;
            // 雷心裂开一道白光，剩下的鼓和骨槌叮叮当当掉到地上
            var c = transform.position;
            Fx.PlateauBolt(c, c + Vector3.up * 3.5f, 0.35f, 0.25f, 0, 0.6f);
            Fx.Play("ToonBurst", c, Vector3.up, Color.white, 2f);
            Fx.Burst(c, PlateauPalette.Shield, 24, 6f, 0.6f, 0.12f, 8);
            Fx.Flash(c, PlateauPalette.Core, 8, 10, 0.2f);
            var parts = new List<Transform>();
            foreach (var d in drums)
                if (d && d.gameObject.activeSelf)
                    parts.Add(d);
            if (mallet) parts.Add(malletPivot);
            foreach (var p in parts)
            {
                p.SetParent(null, true);
                var rb = p.gameObject.AddComponent<Rigidbody>();
                rb.mass = 2f;
                rb.linearVelocity = new Vector3(Random.Range(-2f, 2f), Random.Range(1f, 3f), Random.Range(-2f, 2f));
                rb.angularVelocity = Random.insideUnitSphere * 8f;
                var bc = p.gameObject.AddComponent<SphereCollider>();
                bc.radius = 0.25f;
                foreach (var z in p.GetComponentsInChildren<HitZone>(true)) Destroy(z.gameObject);
                Destroy(p.gameObject, 3.5f);
            }
            if (coreModel) coreModel.gameObject.SetActive(false);
        }

        /// <summary>强制出招（试玩套件 / 节拍条）</summary>
        public void Force(string id)
        {
            Notice(false);
            Begin(id == "clap" ? PlateauMoves.LianguClap : id == "orb" ? PlateauMoves.LianguOrb : PlateauMoves.LianguBeat);
        }

        /// <summary>打碎第 i 面鼓（试玩套件）</summary>
        public void DebugBreakDrum(int i)
        {
            if (i >= 0 && i < Drums && drumHp[i] > 0) BreakDrum(i);
        }
    }
}
