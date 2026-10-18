using System;
using Spiritfire.Art;
using UnityEngine;
using UnityEngine.InputSystem;

namespace Spiritfire.Game
{
    /// <summary>
    /// 玩家武器（Three.js 版 WeaponSystem + Firing 的切片版）：
    ///   两个武器槽（1 / 2 / 滚轮切换，切枪 0.35 s）· 左键开火（半自动 / 全自动）· 右键开镜 · R 换弹（打空自动换）
    ///   霰弹逐发装填，装填中开火立即打断。
    /// 弹道：从眼睛（准星）发射线，曳光从枪口画到命中点；扩散 = (腰射 / 开镜基础 × 移动 × 空中 + 连射累积) 的半角。
    /// 后坐：抬枪量 = pitch × (1 + 连发数 × climb) × 开镜减半 × RecoilScale，交给 <see cref="PlayerMotor.AddRecoil"/> 记成回正债。
    /// 第一人称：每把枪一个 rig（枪模 + 手臂），由 PlayerRigBuilder 生成，这里只切换显示、写开镜 / 下沉 / 后坐。
    /// </summary>
    public sealed class WeaponController : MonoBehaviour
    {
        [Serializable]
        public sealed class Rig
        {
            public string weaponId;
            public FirstPersonViewmodel view;
        }

        public Camera eye;
        public Rig[] rigs = Array.Empty<Rig>();
        public string startWeapon = "smg";
        public float baseFov = 70f;

        public readonly WeaponInstance[] slots = new WeaponInstance[2];
        public int ActiveSlot { get; private set; }
        public WeaponInstance Active => slots[ActiveSlot];
        public bool Reloading => reloadTotal > 0;
        public float ReloadProgress => reloadTotal > 0 ? Mathf.Clamp01(reloadElapsed / reloadTotal) : 0;
        /// <summary>当前散布半角（弧度，含霰弹锥），准星读取</summary>
        public float HudSpread { get; private set; }
        public float AimT => aimT;

        public event Action<WeaponInstance> Fired;
        public event Action Changed;

        /// <summary>自动化冒烟测试：绕过鼠标锁定与真实输入，由 testFire / testAim / testReload / testSwitch 驱动</summary>
        public static bool TestMode;
        [NonSerialized] public bool testFire, testAim, testReload;
        [NonSerialized] public int testSwitch = -1;
        bool prevTestFire;

        PlayerMotor motor;
        PlayerVitals vitals;
        Collider selfCollider;
        float cooldown, bloom, lastShot = -10, aimT, switchTimer, reloadElapsed, reloadTotal, shellTimer;
        int consecutive;
        bool shellReload, triggerHeld;
        float shakeAmp, shakeTime;
        /// <summary>
        /// 后坐整体缩放。这不是硬核 FPS：目标是「射得爽」，后坐只做手感、不做惩罚——镜头只轻轻上跳（0.3）且会完全回正，
        /// 枪模保留明显的上抬（0.55）当作打击感。要单独调某把枪改武器表，整体手感改这里
        /// </summary>
        const float RecoilScale = 0.3f, ViewKickScale = 0.55f;
        Vector3 shakeSeed;

        void Awake()
        {
            motor = GetComponent<PlayerMotor>();
            vitals = GetComponent<PlayerVitals>();
            selfCollider = GetComponent<Collider>();
            var def = WeaponLibrary.Get(startWeapon) ?? WeaponLibrary.Get("smg");
            slots[0] = new WeaponInstance(def);
            ApplyRigs();
        }

        StatSheet Stats => vitals ? vitals.stats : null;

        /// <summary>拾取 / 宝箱给的枪：有空槽放空槽，否则替换当前槽；返回被替换下来的枪</summary>
        public WeaponInstance Give(WeaponInstance w)
        {
            int slot = slots[0] == null ? 0 : slots[1] == null ? 1 : ActiveSlot;
            var old = slots[slot];
            slots[slot] = w;
            SwitchTo(slot, true);
            return old;
        }

        public void RefillReserve(float fraction)
        {
            foreach (var w in slots)
                if (w != null) w.reserve = Mathf.Min(w.def.reserve, w.reserve + Mathf.CeilToInt(w.def.reserve * fraction));
            Changed?.Invoke();
        }

        void SwitchTo(int slot, bool force = false)
        {
            if (slots[slot] == null || (slot == ActiveSlot && !force)) return;
            if (slot != ActiveSlot || force) GameAudio.Play("weapon_switch", 0.7f);
            ActiveSlot = slot;
            CancelReload();
            switchTimer = 0.35f;
            consecutive = 0;
            ApplyRigs();
            Changed?.Invoke();
        }

        void ApplyRigs()
        {
            var id = Active?.def.id;
            foreach (var r in rigs)
                if (r.view) r.view.gameObject.SetActive(r.weaponId == id);
        }

        FirstPersonViewmodel ActiveView()
        {
            var id = Active?.def.id;
            foreach (var r in rigs)
                if (r.weaponId == id) return r.view;
            return null;
        }

        void Update()
        {
            var w = Active;
            if (w == null || !eye) return;
            float dt = Time.deltaTime, now = Time.time;
            var mouse = Mouse.current;
            var kb = Keyboard.current;
            bool canAct = (TestMode || (motor.inputEnabled && Cursor.lockState == CursorLockMode.Locked)) && (!vitals || !vitals.Dead);
            var def = w.def;

            // ── 切枪 ──
            if (canAct && kb != null)
            {
                if (kb.digit1Key.wasPressedThisFrame) SwitchTo(0);
                if (kb.digit2Key.wasPressedThisFrame) SwitchTo(1);
                if (kb.xKey.wasPressedThisFrame || (mouse != null && Mathf.Abs(mouse.scroll.ReadValue().y) > 0.1f))
                    SwitchTo(slots[1 - ActiveSlot] != null ? 1 - ActiveSlot : ActiveSlot);
            }
            if (TestMode && testSwitch >= 0)
            {
                SwitchTo(testSwitch);
                testSwitch = -1;
            }
            if (switchTimer > 0) switchTimer -= dt;

            // ── 开镜 ──
            bool aimInput = TestMode ? testAim : mouse != null && mouse.rightButton.isPressed;
            bool aiming = canAct && aimInput && !Reloading && switchTimer <= 0 && !motor.Dashing;
            aimT = Mathf.MoveTowards(aimT, aiming ? 1 : 0, dt * 7f);
            float fov = baseFov + def.aimFov * aimT;
            eye.fieldOfView = fov;
            motor.lookScale = Mathf.Tan(fov * 0.5f * Mathf.Deg2Rad) / Mathf.Tan(baseFov * 0.5f * Mathf.Deg2Rad);

            // ── 换弹 ──
            bool fireDown = canAct && (TestMode ? testFire : mouse != null && mouse.leftButton.isPressed);
            bool firePressed = canAct && (TestMode ? testFire && !prevTestFire : mouse != null && mouse.leftButton.wasPressedThisFrame);
            prevTestFire = testFire;
            if (canAct && (TestMode ? testReload : kb != null && kb.rKey.wasPressedThisFrame)) StartReload();
            testReload = false;
            if (w.mag <= 0 && !Reloading && w.reserve > 0 && switchTimer <= 0 && (fireDown || now - lastShot > 0.35f)) StartReload();
            if (Reloading) UpdateReload(dt, firePressed && shellReload && w.mag > 0);

            // ── 开火 ──
            cooldown -= dt;
            if (!fireDown) triggerHeld = false;
            bool wantFire = def.mode != FireMode.Semi ? fireDown : firePressed || (fireDown && !triggerHeld);
            // 空膛：弹匣和备弹都打空了还扣扳机
            if (firePressed && w.mag <= 0 && w.reserve <= 0 && !Reloading) GameAudio.Play("dry_fire", 0.8f);
            if (wantFire && cooldown <= 0 && !Reloading && switchTimer <= 0 && w.mag > 0 && !motor.Dashing)
            {
                Fire(w);
                triggerHeld = true;
                cooldown = 1f / Mathf.Max(0.1f, def.fireRate * (Stats?.Mult(Stat.FireRatePct) ?? 1));
            }

            UpdateSpread(dt, def, now);

            var view = ActiveView();
            if (view)
            {
                view.aim = aimT;
                view.lower = Mathf.Max(Reloading ? Mathf.Sin(Mathf.Clamp01(ReloadProgress) * Mathf.PI) * 0.6f : 0, switchTimer > 0 ? switchTimer / 0.35f : 0);
            }
        }

        void LateUpdate()
        {
            UpdateBeam();
            // 屏震：在 PlayerMotor 写完视角之后叠一个小的随机转角（开枪的抖动和敌人的震动取较强的那个）
            if (!eye) return;
            if (shakeTime > 0) shakeTime -= Time.deltaTime;
            float a = Mathf.Max(shakeTime > 0 ? shakeAmp * Mathf.Clamp01(shakeTime / 0.12f) : 0, CameraShake.Current);
            if (a <= 0) return;
            float t = Time.time * 40f;
            eye.transform.localRotation *= Quaternion.Euler(
                (Mathf.PerlinNoise(t, shakeSeed.x) - 0.5f) * a * 6f, (Mathf.PerlinNoise(shakeSeed.y, t) - 0.5f) * a * 6f, 0);
        }

        void UpdateSpread(float dt, WeaponDef def, float now)
        {
            float delay = Mathf.Clamp(1.25f / Mathf.Max(0.1f, def.fireRate), 0.08f, 0.35f);
            if (now - lastShot > delay) bloom = Mathf.Max(0, bloom - def.spreadRecovery * dt);
            float baseSpread = Mathf.Lerp(def.spreadHip, def.spreadAim, aimT);
            var v = motor.Velocity;
            // 跑动 / 滞空只轻微放大散布（Three.js 版是 +60% / ×1.5）：边跑边打、跳起来打都要打得中（同 RecoilScale 注释：要射得爽）
            float moveF = 1 + Mathf.Clamp01(new Vector2(v.x, v.z).magnitude / 7.5f) * (0.2f - 0.1f * aimT);
            float airF = motor.Grounded ? 1 : 1.15f - 0.1f * aimT;
            spreadNow = baseSpread * moveF * airF + bloom * (1 - 0.45f * aimT);
            float hud = Mathf.Clamp(spreadNow + PelletCone(def), 0, 0.25f);
            HudSpread = Mathf.Lerp(HudSpread, hud, 1 - Mathf.Exp(-18f * dt));
        }

        float spreadNow;
        float PelletCone(WeaponDef def) => def.pelletCone > 0 ? def.pelletCone * Mathf.Lerp(1, 0.72f, aimT) : 0;

        void StartReload()
        {
            var w = Active;
            if (w == null || Reloading || w.mag >= Mathf.RoundToInt(w.def.mag * (Stats?.Mult(Stat.MagPct) ?? 1)) || w.reserve <= 0) return;
            float speed = Stats?.Mult(Stat.ReloadSpeedPct) ?? 1;
            shellReload = w.def.reload == ReloadStyle.Shell;
            reloadElapsed = 0;
            if (shellReload)
            {
                int need = Mathf.Min(w.def.mag - w.mag, w.reserve);
                reloadTotal = (w.def.reloadStart + w.def.shellTime * need) / speed;
                shellTimer = w.def.reloadStart / speed;
            }
            else reloadTotal = w.def.reloadTime / speed;
            GameAudio.Play("reload_start", 0.8f);
            Changed?.Invoke();
        }

        void UpdateReload(float dt, bool interrupt)
        {
            var w = Active;
            if (interrupt)
            {
                CancelReload();
                return;
            }
            reloadElapsed += dt;
            float speed = Stats?.Mult(Stat.ReloadSpeedPct) ?? 1;
            int capacity = Mathf.RoundToInt(w.def.mag * (Stats?.Mult(Stat.MagPct) ?? 1));
            if (shellReload)
            {
                shellTimer -= dt;
                while (shellTimer <= 0 && w.mag < capacity && w.reserve > 0)
                {
                    w.mag++;
                    w.reserve--;
                    shellTimer += w.def.shellTime / speed;
                    // 逐发装填：每塞一发一声轻响
                    GameAudio.Play("reload_end", 0.45f, 1.3f + UnityEngine.Random.value * 0.1f);
                    Changed?.Invoke();
                }
                if (w.mag >= capacity || w.reserve <= 0) CancelReload();
            }
            else if (reloadElapsed >= reloadTotal)
            {
                int take = Mathf.Min(capacity - w.mag, w.reserve);
                w.mag += take;
                w.reserve -= take;
                GameAudio.Play("reload_end", 0.85f);
                CancelReload();
                Changed?.Invoke();
            }
        }

        void CancelReload()
        {
            reloadTotal = 0;
            reloadElapsed = 0;
        }

        void Fire(WeaponInstance w)
        {
            var def = w.def;
            w.mag--;
            float now = Time.time;
            float gap = 1f / Mathf.Max(0.1f, def.fireRate);
            consecutive = now - lastShot < gap * 1.6f + 0.05f ? consecutive + 1 : 0;
            lastShot = now;

            var camT = eye.transform;
            var origin = camT.position;
            var muzzle = camT.TransformPoint(Vector3.Lerp(new Vector3(0.2f, -0.13f, 0.75f), new Vector3(0, -0.08f, 0.7f), aimT));
            float cone = PelletCone(def);
            float dmg = def.damage * w.DamageMult;
            var tracerColor = new Color(1f, 0.82f, 0.5f, 1f);
            // 整发的方向先按散布偏一次（霰弹整团跟着走），每颗弹丸再在锥内偏
            var center = Scatter(camT.forward, camT, spreadNow);
            if (def.projectile != null) Launch(origin, center, muzzle, def, dmg);
            else if (def.mode == FireMode.Beam) BeamTick(origin, center, muzzle, def, dmg);
            else
                for (int i = 0; i < def.pellets; i++)
                {
                    var dir = def.pellets > 1 ? Scatter(center, camT, cone) : center;
                    Shoot(origin, dir, muzzle, def, dmg, tracerColor, def.pellets > 1 ? 0.6f : 1f);
                }

            bloom = Mathf.Min(def.spreadMax, bloom + def.spreadPerShot);
            float climb = 1 + Mathf.Min(consecutive, 12) * def.recoilClimb;
            float k = 1 - 0.5f * aimT;
            float pitch = def.recoilPitch * climb * k * UnityEngine.Random.Range(0.85f, 1.15f);
            float yaw = (def.recoilBias + UnityEngine.Random.Range(-1f, 1f) * def.recoilYaw) * k;
            motor.AddRecoil(pitch * RecoilScale * Mathf.Rad2Deg, yaw * RecoilScale * Mathf.Rad2Deg);
            ActiveView()?.Kick(def.kickBack * 0.76f * ViewKickScale, def.kickRot * ViewKickScale);
            ShotFx.Instance?.MuzzleFlash(muzzle, def.flash / 0.12f);
            // 枪声（光束武器是持续音：每次开火刷新）
            if (def.mode == FireMode.Beam) GameAudio.HoldBeam(def.sfxVolume);
            else GameAudio.Play(def.sfx, def.sfxVolume, 0.94f + UnityEngine.Random.value * 0.12f);
            shakeAmp = def.shake;
            shakeTime = def.shake > 0.15f ? 0.16f : 0.08f;
            shakeSeed = new Vector3(UnityEngine.Random.value * 10, UnityEngine.Random.value * 10, 0);
            Fired?.Invoke(w);
            Changed?.Invoke();
        }

        static readonly Collider[] overlap = new Collider[8];

        /// <summary>起点落在哪个活着的敌人碰撞体里（贴脸开枪）：返回那个命中盒，没有则 null</summary>
        Hitbox PointBlank(Vector3 origin)
        {
            int n = Physics.OverlapSphereNonAlloc(origin, 0.05f, overlap, 1 << Layers.Character, QueryTriggerInteraction.Ignore);
            for (int i = 0; i < n; i++)
            {
                var c = overlap[i];
                if (c == selfCollider) continue;
                var hb = c.GetComponent<Hitbox>();
                if (hb && hb.owner && !hb.owner.Dead) return hb;
            }
            return null;
        }

        DamageInfo HitInfo(WeaponDef def, float amount, Vector3 point, Vector3 dir) => new()
        {
            amount = amount, source = DamageSource.Weapon, critMult = def.critMult, point = point, direction = dir,
            knockback = def.knockback, element = def.element, instigator = this,
            statusChance = def.element != Element.None ? def.elementChance : 0, subElement = def.subElement, subChance = def.subChance,
        };

        /// <summary>
        /// 投射物武器：从枪口射向准星指着的点（射线找落点，最远 60 m），有重力时按飞行时间解抛物线，
        /// 准星指哪儿就落在哪儿（同 Three.js 版 Firing 的抛物线补偿）
        /// </summary>
        void Launch(Vector3 origin, Vector3 dir, Vector3 muzzle, WeaponDef def, float dmg)
        {
            var spec = def.projectile;
            float reach = Mathf.Min(60f, def.range);
            var aimPoint = origin + dir * reach;
            foreach (var h in SortedHits(origin, dir, reach))
            {
                if (h.collider == selfCollider) continue;
                aimPoint = h.point;
                break;
            }
            Vector3 vel;
            if (spec.gravity > 0)
            {
                float t = Mathf.Max(0.05f, Vector3.Distance(muzzle, aimPoint) / spec.speed);
                vel = EnemyProjectile.Ballistic(muzzle, aimPoint, t, spec.gravity);
            }
            else vel = (aimPoint - muzzle).normalized * spec.speed;
            var info = HitInfo(def, dmg, muzzle, dir);
            var p = PlayerProjectile.Spawn(muzzle, vel, info, spec.radius, spec.lifetime, spec.gravity, spec.explosionRadius);
            p.explodeOnExpire = spec.explodeOnExpire;
            p.bounces = spec.bounces;
            p.rollAfter = spec.rollAfter;
            ProjectileLook(p.transform, spec);
            p.onImpact = point =>
            {
                ShotFx.Instance?.Impact(point, Vector3.up, def.element == Element.Fire, spec.explosionRadius * 2.2f);
                ShotFx.Instance?.MuzzleFlash(point + Vector3.up * 0.4f, spec.explosionRadius * 1.3f);
                Telegraph.Wave(point + Vector3.up * 0.05f, spec.explosionRadius, 20f, spec.color);
            };
        }

        static void ProjectileLook(Transform parent, ProjectileSpec spec)
        {
            var core = GameObject.CreatePrimitive(spec.visual == "orb" ? PrimitiveType.Sphere : PrimitiveType.Capsule);
            Destroy(core.GetComponent<Collider>());
            core.transform.SetParent(parent, false);
            core.transform.localRotation = Quaternion.Euler(90, 0, 0);
            float r = spec.radius * 2f * spec.scale;
            core.transform.localScale = spec.visual == "orb" ? Vector3.one * r * 1.2f : new Vector3(r, r * 0.9f, r);
            var mr = core.GetComponent<Renderer>();
            mr.sharedMaterial = FxMaterials.Unlit;
            FxMaterials.Tint(mr, Color.Lerp(spec.color, Color.white, 0.25f));
            FxMaterials.GlowSprite(parent, r * 6f, new Color(spec.color.r, spec.color.g, spec.color.b, 0.7f));
            var trail = parent.gameObject.AddComponent<TrailRenderer>();
            trail.time = 0.22f;
            trail.startWidth = r * 0.8f;
            trail.endWidth = 0;
            trail.sharedMaterial = FxMaterials.Additive;
            trail.startColor = new Color(spec.color.r, spec.color.g, spec.color.b, 0.8f);
            trail.endColor = new Color(spec.color.r, spec.color.g, spec.color.b, 0);
            trail.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
        }

        // ── 光束（雷弧发射器）──
        LineRenderer beamLine;
        Vector3 beamEnd;
        float beamUntil;

        /// <summary>光束一跳：射线命中 → 伤害 + 雷殛几率；打中敌人时向附近 1 个敌人弹射（伤害 × chainFraction）</summary>
        void BeamTick(Vector3 origin, Vector3 dir, Vector3 muzzle, WeaponDef def, float dmg)
        {
            var target = Shoot(origin, dir, muzzle, def, dmg, Color.clear, 0.45f, out var end);
            beamEnd = end;
            beamUntil = Time.time + 1.4f / Mathf.Max(1, def.fireRate);
            if (!target || def.chainFraction <= 0) return;
            foreach (var o in ReactionSystem.Nearest(end, def.chainRange, 1, target, true))
            {
                var oc = ReactionSystem.CenterOf(o);
                Lightning.Spawn(end, oc, DamageTable.ElementColor(def.element));
                var info = HitInfo(def, dmg * def.chainFraction, oc, (oc - end).normalized);
                info.depth = 1;
                Combat.DamageEnemy(o, info);
            }
        }

        void UpdateBeam()
        {
            bool on = Time.time < beamUntil && Active?.def.mode == FireMode.Beam;
            if (!on)
            {
                if (beamLine) beamLine.enabled = false;
                return;
            }
            if (!beamLine)
            {
                var go = new GameObject("Beam");
                beamLine = go.AddComponent<LineRenderer>();
                beamLine.positionCount = 8;
                beamLine.sharedMaterial = FxMaterials.Additive;
                // 枪口那头离相机很近，透视会把它放大成一大片：起点细、远端粗
                beamLine.widthCurve = new AnimationCurve(new Keyframe(0, 0.012f), new Keyframe(0.25f, 0.035f), new Keyframe(1, 0.07f));
                beamLine.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            }
            beamLine.enabled = true;
            var camT = eye.transform;
            var from = camT.TransformPoint(Vector3.Lerp(new Vector3(0.2f, -0.13f, 0.75f), new Vector3(0, -0.08f, 0.7f), aimT));
            var c = DamageTable.ElementColor(Active.def.element);
            float flicker = 0.75f + UnityEngine.Random.value * 0.25f;
            beamLine.startColor = new Color(c.r, c.g, c.b, 0.55f * flicker);
            beamLine.endColor = new Color(Mathf.Lerp(c.r, 1, 0.3f), Mathf.Lerp(c.g, 1, 0.3f), 1f, 0.9f * flicker);
            var d = beamEnd - from;
            var side = Vector3.Cross(d, Vector3.up).normalized;
            var up = Vector3.Cross(side, d).normalized;
            for (int i = 0; i < 8; i++)
            {
                float t = i / 7f;
                float k = Mathf.Sin(t * Mathf.PI) * 0.12f;
                beamLine.SetPosition(i, Vector3.Lerp(from, beamEnd, t) + side * UnityEngine.Random.Range(-k, k) + up * UnityEngine.Random.Range(-k, k));
            }
        }

        RaycastHit[] SortedHits(Vector3 origin, Vector3 dir, float range)
        {
            var hits = Physics.RaycastAll(origin, dir, range, Layers.ShotMask, QueryTriggerInteraction.Ignore);
            Array.Sort(hits, (a, b) => a.distance.CompareTo(b.distance));
            return hits;
        }

        static Vector3 Scatter(Vector3 dir, Transform basis, float halfAngle)
        {
            if (halfAngle <= 0) return dir;
            // 圆锥内均匀分布（半径取 sqrt 让中心不过密）
            float r = Mathf.Sqrt(UnityEngine.Random.value) * Mathf.Tan(halfAngle);
            float a = UnityEngine.Random.value * Mathf.PI * 2;
            return (dir + basis.right * (Mathf.Cos(a) * r) + basis.up * (Mathf.Sin(a) * r)).normalized;
        }

        void Shoot(Vector3 origin, Vector3 dir, Vector3 muzzle, WeaponDef def, float dmg, Color tracer, float fxScale) =>
            Shoot(origin, dir, muzzle, def, dmg, tracer, fxScale, out _);

        /// <summary>射线命中结算；返回打中的敌人（没打中 / 打在地形上为 null），end = 落点。tracer 透明时不画曳光</summary>
        Damageable Shoot(Vector3 origin, Vector3 dir, Vector3 muzzle, WeaponDef def, float dmg, Color tracer, float fxScale, out Vector3 end)
        {
            Damageable struck = null;
            end = origin + dir * def.range;
            var hits = SortedHits(origin, dir, def.range);
            // 贴脸：射线起点已经在敌人胶囊里时 RaycastAll 打不到它（敌人走进玩家身上、大体型敌人），直接算命中这个敌人
            var inside = PointBlank(origin);
            if (inside)
            {
                var pb = new RaycastHit();
                hits = new[] { pb };
                hits[0].point = origin + dir * 0.3f;
                hits[0].normal = -dir;
                hits[0].distance = 0.3f;
            }
            for (int i = 0; i < hits.Length; i++)
            {
                var h = hits[i];
                Hitbox hb;
                Damageable target;
                if (inside)
                {
                    hb = inside;
                    target = inside.owner;
                }
                else
                {
                    if (h.collider == selfCollider) continue;
                    hb = h.collider.GetComponent<Hitbox>();
                    target = hb ? hb.owner : h.collider.GetComponentInParent<Damageable>();
                }
                // 身体胶囊往往把头 / 弱点包在里面：射线先进胶囊，但 1.5 m 内穿过同一单位的弱点就按弱点算
                if (target && hb && !hb.weakpoint && !inside)
                    for (int j = i + 1; j < hits.Length && hits[j].distance < h.distance + 1.5f; j++)
                    {
                        var wb = hits[j].collider.GetComponent<Hitbox>();
                        if (wb && wb.weakpoint && wb.owner == target)
                        {
                            hb = wb;
                            h = hits[j];
                            break;
                        }
                    }
                end = h.point;
                if (target && !target.Dead)
                {
                    // 出生中 / 遁地中（还露在外面时）：子弹停在身上，结算出「免疫」字样，让玩家知道不是没打中
                    var info = HitInfo(def, dmg * def.Falloff(h.distance) * (hb ? hb.multiplier : 1f), h.point, dir);
                    info.weakpoint = hb && hb.weakpoint;
                    Combat.DamageEnemy(target, info);
                    struck = target;
                    ShotFx.Instance?.Impact(h.point, h.normal, !target.untargetable, fxScale);
                }
                else if (!target)
                    ShotFx.Instance?.Impact(h.point, h.normal, false, fxScale);
                break;
            }
            if (tracer.a > 0) ShotFx.Instance?.Tracer(muzzle, end, tracer, def.pellets > 1 ? 0.012f : 0.02f);
            return struck;
        }
    }
}
