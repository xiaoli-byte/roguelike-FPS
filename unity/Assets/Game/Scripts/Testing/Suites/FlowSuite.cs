using System.Collections;
using System.Collections.Generic;
using System.Linq;
using Spiritfire.Art;
using UnityEngine;
using UnityEngine.SceneManagement;
using static UnityEngine.Object;

namespace Spiritfire.Game.Testing
{
    /// <summary>
    /// 场景流转冒烟（bridge.sh playtest flow；场景 Core，L1 验收：Core → 1-1 → 出口 → 再进 1-1）：
    ///   1. 从 Core 启动：SceneFlow 自动开一局、叠加加载第一关、在 PlayerSpawn 组装玩家；检查「世界」只有一份（玩家、HUD、会话、主相机、音频监听各一个，
    ///      只加载了 Core + 关卡两个场景，活动场景是关卡，时间缩放 1）；
    ///   2. 准备要带走的东西：第二把枪（左轮，精良 +2，弹匣打掉几发）、一卷秘卷两层（记下它加的属性）、灵石 +137、结契一只灵宠（3 级）、
    ///      一颗在飞的投射物（换关时要被投射物池回收）；
    ///   3. 出口：强制开启 → 走到门前按 F → 本关结算；结算面板（时间停住）上把生命 / 护盾改成特定值 → 「继续」（F 的效果）。
    ///      下一关（1-2）还没建时 SceneFlow 带着本局进度再走一遍 1-1——正是这里要测的「再进 1-1」；
    ///   4. 换关后：旧玩家已销毁、世界仍只有一份、投射物池已清空、旧关卡的场地 / 出口 / 灵兽台没有残留；
    ///      武器（id / 品质 / 强化 / 元素 / 弹药 / 当前槽）、秘卷层数与属性、灵石、灵宠（种类 / 等级）、生命护盾全部带过来；
    ///   5. 阵亡（这一局结算一次）→ 重来本关（R 的效果）：灵石回到进关快照、武器 / 灵宠照旧、不重复结算。
    /// 运行时报错由宿主记不合格（PlaytestRunner）。
    /// </summary>
    public sealed class FlowSuite : PlaytestSuite
    {
        public override string Id => "flow";
        public override string Scene => SceneFlow.CorePath;

        const float LoadTimeout = 90f;

        struct WeaponState
        {
            public string id;
            public int rarity, level, mag, reserve;
            public Element element;
            public override string ToString() => $"{id}（品质 {rarity} +{level} {element} {mag}/{reserve}）";
        }

        int arrivedProjectiles = -1;
        bool arrivedPoolRoot;

        protected override IEnumerator Steps()
        {
            // ── 1. Core 开局 → 第一关 ──
            yield return WaitReady("开局进第一关");
            var flow = SceneFlow.Instance;
            if (!flow || flow.Player == null)
            {
                Fail("SceneFlow 没有组装出玩家（Core 场景不对？先 bridge.sh core）");
                yield break;
            }
            CheckWorld("开局");
            var p = flow.Player;
            var run = RunState.Current;
            Line($"开局：{flow.Current?.Label ?? flow.CurrentScene.path}，英雄 {p.hero.id}，局 seed {run?.seed}（调试局 {run?.dev}），换关 {flow.Transitions} 次");
            // 从 Core 开局走的是正式流程（换关协程）：不摆测试灵兽台（只在直接打开关卡的调试局里自动摆）
            int startAltars = FindObjectsByType<PetAltar>().Length;
            if (startAltars > 0) Fail($"从 Core 开局（正式流程）场景里有 {startAltars} 个测试灵兽台");
            if (run == null)
            {
                Fail("没有 RunState");
                yield break;
            }
            WeaponController.TestMode = true;
            Interactor.TestMode = true;
            HeroSkills.TestMode = true;
            PetOwner.TestMode = true;
            Shot(p.cam, "flow_start");

            // ── 2. 要带走的东西 ──
            var weapons = p.weapons;
            var giftDef = WeaponLibrary.Get("revolver") ?? WeaponLibrary.All.FirstOrDefault(d => d.id != weapons.Active?.def.id);
            if (giftDef != null)
            {
                var gift = new WeaponInstance(giftDef, 1) { level = 2 };
                gift.mag = Mathf.Max(0, gift.mag - 2);
                weapons.Give(gift);
                yield return new WaitForSeconds(0.5f);
            }
            if (weapons.slots[0] != null) weapons.slots[0].reserve = Mathf.Max(0, weapons.slots[0].reserve - 11);
            var wantWeapons = Snapshot(weapons);
            int wantSlot = weapons.ActiveSlot;
            Line($"武器：{string.Join("、", wantWeapons)}，当前槽 {wantSlot}");

            var inv = LootDirector.Instance ? LootDirector.Instance.scrolls : null;
            var scroll = PickScroll();
            Stat? scrollStat = scroll is StatScroll ss && ss.stats.Length > 0 ? ss.stats[0].stat : null;
            int wantStacks = 0;
            float wantStatValue = 0;
            if (inv == null || scroll == null) Fail($"没有秘卷清单或秘卷表是空的（LootDirector={LootDirector.Instance}）");
            else
            {
                inv.Gain(scroll, p.vitals);
                inv.Gain(scroll, p.vitals);
                wantStacks = inv.Stacks(scroll.id);
                if (scrollStat is { } st) wantStatValue = p.vitals.stats.Get(st);
                Line($"秘卷：{scroll.name}（{scroll.id}）{wantStacks} 层" + (scrollStat is { } s2 ? $"，{s2} = {wantStatValue:F3}" : ""));
            }

            run.Credit(137, "playtest");
            int wantCoins = run.coins;
            Line($"灵石：{wantCoins}");

            var owner = PetOwner.Instance;
            var petDef = PetLibrary.All.Length > 0 ? PetLibrary.All[0] : null;
            string wantPet = null;
            int wantPetLevel = 0;
            if (!owner || petDef == null) Fail($"没有 PetOwner（PetBootstrap 没补挂？）或灵宠表是空的");
            else
            {
                owner.Bind(petDef, 3, 1f);
                yield return new WaitForSeconds(0.3f);
                wantPet = owner.Current ? owner.Current.def.id : null;
                wantPetLevel = owner.Current ? owner.Current.Level : 0;
                Line($"灵宠：{wantPet} Lv.{wantPetLevel}");
            }

            // 一颗往天上飞 20 s 的投射物：换关时投射物池要把它回收
            var spec = new PlayerProjectileSpec(p.cam.transform.position + Vector3.up * 3, Vector3.up * 4,
                new DamageInfo { amount = 1, source = DamageSource.Weapon }, 0.1f, 20f);
            PlayerProjectile.Spawn(in spec);
            Line($"在飞的投射物：{PlayerProjectile.LiveCount}，池根 {(GameObject.Find("[Projectiles]") ? "有" : "无")}");

            int sites0 = FindObjectsByType<EncounterSite>().Length;
            int cleared0 = run.stagesCleared;
            var oldRoot = p.root;

            // ── 3. 出口 → 结算 → 继续 ──
            var portal = FindAnyObjectByType<ExitPortal>();
            var session = GameSession.Instance;
            if (!portal || !session)
            {
                Fail($"缺少出口或会话：portal={portal} session={session}");
                yield break;
            }
            portal.ForceOpen();
            yield return null;
            if (!portal.IsOpen) Fail("ForceOpen 之后出口没有开启");
            Teleport(p.motor, portal.transform.position - portal.transform.forward * 3.5f);
            yield return new WaitForSeconds(0.5f);
            Aim(p.motor, p.cam.transform, portal.Focus);
            yield return new WaitForSeconds(0.1f);
            if (p.interactor.Current as ExitPortal != portal) Fail($"站在出口前没有交互提示（当前 {p.interactor.Current?.Prompt ?? "无"}）");
            Line($"出口提示：{portal.Prompt}");
            p.interactor.testInteract = true;
            yield return new WaitForSecondsRealtime(0.4f);
            if (!session.Completed)
            {
                Fail("进入出口后没有本关结算");
                session.CompleteStage();
            }
            Shot(p.cam, "flow_summary");
            // 结算面板上时间停着：生命 / 护盾改成特定值，换关时原样带过去
            float wantHp = Mathf.Round(p.vitals.MaxHealth * 0.55f), wantShield = Mathf.Min(5f, p.vitals.MaxShield);
            p.vitals.health = wantHp;
            p.vitals.shield = wantShield;
            int transitions0 = flow.Transitions;
            flow.Arrived += OnArrived;
            session.Continue();
            if (!flow.Busy) Fail("结算面板上「继续」之后没有开始换关");
            yield return WaitReady("换关（再进本关）");
            flow.Arrived -= OnArrived;

            // ── 4. 换关后 ──
            if (flow.Transitions != transitions0 + 1) Fail($"换关次数 {transitions0} → {flow.Transitions}（应 +1）");
            CheckWorld("换关后");
            var q = flow.Player;
            if (q == null) yield break;
            if (oldRoot) Fail("旧玩家没有销毁");
            if (q.root == oldRoot) Fail("换关后还是同一个玩家物体（应重新组装）");
            run = RunState.Current;
            Line($"换关后：{flow.Current?.Label ?? flow.CurrentScene.path}，已过关 {cleared0} → {run.stagesCleared}");
            if (run.stagesCleared != cleared0 + 1) Fail("RunState.stagesCleared 没有 +1");

            // 投射物池（在新关卡就绪那一刻、时间放开之前记的）
            Line($"投射物：新关卡就绪时在飞 {arrivedProjectiles}，池根 {(arrivedPoolRoot ? "还在" : "已清")}");
            if (arrivedProjectiles != 0) Fail($"换关后还有 {arrivedProjectiles} 颗在飞的投射物（ProjectilePools.Clear 没生效）");
            if (arrivedPoolRoot) Fail("换关后旧的投射物池根还在");

            // 旧关卡没有残留
            int sites1 = FindObjectsByType<EncounterSite>().Length;
            int portals = FindObjectsByType<ExitPortal>().Length;
            int altars = FindObjectsByType<PetAltar>().Length;
            Line($"关卡物件：场地 {sites0} → {sites1}，出口 {portals}，灵兽台 {altars}");
            if (sites1 != sites0) Fail($"场地数 {sites0} → {sites1}（旧关卡没卸干净或新关卡没加载全）");
            if (portals != 1) Fail($"出口有 {portals} 个");
            // 测试灵兽台只在直接打开的关卡（调试局）里自动摆，换关走的是正式流程：旧关卡的随场景卸掉，新关卡不摆
            if (altars > 0) Fail($"换关后还有 {altars} 个测试灵兽台（旧关卡的没清掉，或换关后又摆了一个）");
            foreach (var go in flow.gameObject.scene.GetRootGameObjects())
                if (go.GetComponentInChildren<EncounterSite>(true) || go.GetComponentInChildren<Pickup>(true) || go.GetComponentInChildren<Chest>(true))
                    Fail($"Core 场景里混进了关卡物件 {go.name}");

            // 武器
            var gotWeapons = Snapshot(q.weapons);
            Line($"武器：{string.Join("、", gotWeapons)}，当前槽 {q.weapons.ActiveSlot}");
            if (!Carried(wantWeapons, gotWeapons)) Fail($"武器没有原样带过来：应为 {string.Join("、", wantWeapons)}（备弹只许因进关补给变多）");
            if (q.weapons.ActiveSlot != wantSlot) Fail($"当前槽 {q.weapons.ActiveSlot}，应为 {wantSlot}");
            var activeRig = q.weapons.rigs.FirstOrDefault(r => r.view && r.view.gameObject.activeSelf);
            if (q.weapons.rigs.Length == 0) Fail("新玩家没有第一人称 rig（GameDatabase 里没有武器模型？先 bridge.sh core）");
            else if (activeRig == null || activeRig.weaponId != q.weapons.Active?.def.id)
                Fail($"显示的第一人称 rig（{activeRig?.weaponId ?? "无"}）不是手上的枪（{q.weapons.Active?.def.id}）");

            // 秘卷
            inv = LootDirector.Instance ? LootDirector.Instance.scrolls : null;
            if (scroll != null && inv != null)
            {
                int stacks = inv.Stacks(scroll.id);
                Line($"秘卷：{scroll.id} {stacks} 层" + (scrollStat is { } st ? $"，{st} = {q.vitals.stats.Get(st):F3}" : ""));
                if (stacks != wantStacks) Fail($"秘卷层数 {stacks}，应为 {wantStacks}");
                if (scrollStat is { } st2 && Mathf.Abs(q.vitals.stats.Get(st2) - wantStatValue) > 1e-3f)
                    Fail($"秘卷属性没装到新玩家身上：{st2} = {q.vitals.stats.Get(st2)}，应为 {wantStatValue}");
                if (run.scrolls == null || !run.scrolls.TryGetValue(scroll.id, out var saved) || saved != wantStacks)
                    Fail("RunState.scrolls 里没有这卷秘卷的层数");
            }

            // 灵石
            Line($"灵石：{run.coins}");
            if (run.coins != wantCoins) Fail($"灵石 {run.coins}，应为 {wantCoins}");

            // 灵宠
            owner = PetOwner.Instance;
            if (wantPet != null)
            {
                var pet = owner ? owner.Current : null;
                Line($"灵宠：{(pet ? $"{pet.def.id} Lv.{pet.Level}" : "无")}，场上灵宠 {FindObjectsByType<Pet>().Length} 只");
                if (!owner || owner.gameObject != q.root) Fail("PetOwner 不在新玩家身上");
                else if (!pet || pet.def.id != wantPet || pet.Level != wantPetLevel) Fail($"灵宠没有带过来：应为 {wantPet} Lv.{wantPetLevel}");
                if (pet && pet.gameObject.scene != flow.CurrentScene) Fail($"灵宠在 {pet.gameObject.scene.name} 场景里（应在关卡场景，卸载时一起清掉）");
                if (FindObjectsByType<Pet>().Length != 1) Fail($"场上有 {FindObjectsByType<Pet>().Length} 只灵宠（应只有 1 只）");
            }

            // 生命 / 护盾（进关快照记的是恢复之后、时间放开之前的值；护盾之后会自然回复，所以护盾只看快照）
            var entry = flow.EntrySnapshot;
            Line($"生命 {q.vitals.health:F0}/{q.vitals.MaxHealth:F0}（快照 {entry?.hp:F0}，应为 {wantHp:F0}），护盾快照 {entry?.shield:F0}（应为 {wantShield:F0}）");
            if (entry == null) Fail("没有进关快照");
            else
            {
                if (Mathf.Abs(entry.hp - wantHp) > 0.5f) Fail($"生命没有带过来：进关时 {entry.hp}，应为 {wantHp}");
                if (Mathf.Abs(entry.shield - wantShield) > 0.5f) Fail($"护盾没有带过来：进关时 {entry.shield}，应为 {wantShield}");
            }
            // 黑幕淡出那半秒里只允许按「生命回复」属性回一点；多出来的说明有人在恢复之后又改了上限（天赋 / 秘卷晚装会白送生命）
            float regen = Mathf.Max(0, q.vitals.stats.Get(Stat.HpRegen)) * 2f;
            if (q.vitals.health < wantHp - 0.5f || q.vitals.health > wantHp + 0.5f + regen)
                Fail($"生命 {q.vitals.health}，应为 {wantHp}（不该回血）");
            Shot(q.cam, "flow_arrived");

            // ── 5. 阵亡 → 重来本关 ──
            int entryCoins = entry?.coins ?? run.coins;
            run.Credit(500, "playtest");
            Combat.DamagePlayer(99999, q.motor.transform.position + q.motor.transform.forward);
            yield return new WaitForSecondsRealtime(0.6f);
            if (!q.vitals.Dead) Fail("致命伤害后没有阵亡");
            bool banked = RunState.Current != null && RunState.Current.Flag(MetaSave.BankedFlag) != 0;
            Line($"阵亡：结算 {(banked ? "已记" : "没有")}");
            if (!banked) Fail("阵亡后这一局没有结算（MetaSave.BankRun）");
            int transitions1 = flow.Transitions;
            GameSession.Instance.Restart();
            yield return WaitReady("重来本关");
            if (flow.Transitions != transitions1 + 1) Fail("重来本关没有换关");
            CheckWorld("重来本关后");
            var r = flow.Player;
            if (r == null) yield break;
            run = RunState.Current;
            Line($"重来本关：灵石 {run.coins}（进关时 {entryCoins}），生命 {r.vitals.health:F0}，阵亡 {r.vitals.Dead}");
            if (run.coins != entryCoins) Fail($"重来本关后灵石 {run.coins}，应回到进关时的 {entryCoins}");
            if (r.vitals.Dead) Fail("重来本关后玩家还是阵亡状态");
            if (!Carried(wantWeapons, Snapshot(r.weapons))) Fail($"重来本关后武器变了：{string.Join("、", Snapshot(r.weapons))}");
            if (wantPet != null && (!PetOwner.Instance || !PetOwner.Instance.Current || PetOwner.Instance.Current.def.id != wantPet))
                Fail("重来本关后灵宠没了");
            if (run.Flag(MetaSave.BankedFlag) == 0) Fail("重来本关丢了「已结算」标记（再死一次会重复结算）");
            if (GameSession.Instance && GameSession.Instance.Completed) Fail("重来本关后会话还停在结算状态");
            Shot(r.cam, "flow_restart");
        }

        void OnArrived(StageSpec s)
        {
            arrivedProjectiles = PlayerProjectile.LiveCount;
            arrivedPoolRoot = GameObject.Find("[Projectiles]");
        }

        /// <summary>等 SceneFlow 换关结束、玩家就绪</summary>
        IEnumerator WaitReady(string what)
        {
            float t0 = Time.realtimeSinceStartup;
            while (Time.realtimeSinceStartup - t0 < LoadTimeout)
            {
                var f = SceneFlow.Instance;
                if (f && !f.Busy && f.Player != null && f.Player.root) yield break;
                yield return null;
            }
            Fail($"{what}：{LoadTimeout} 秒内没有就绪（SceneFlow={SceneFlow.Instance}，Busy={SceneFlow.Instance?.Busy}）");
        }

        /// <summary>世界只有一份：玩家 / 武器 / HUD / 会话 / 流转 / 掉落各一个，主相机一个、音频监听一个，只加载 Core + 关卡，时间缩放 1</summary>
        void CheckWorld(string when)
        {
            void One<T>(string what) where T : Object
            {
                int n = FindObjectsByType<T>().Length;
                if (n != 1) Fail($"{when}：{what} 有 {n} 个（应为 1）");
            }
            One<PlayerVitals>("玩家");
            One<WeaponController>("武器控制");
            One<Hud>("HUD");
            One<GameSession>("会话");
            One<SceneFlow>("场景流转");
            One<LootDirector>("掉落");
            One<SkillHud>("技能栏");
            int mainCams = FindObjectsByType<Camera>().Count(c => c.CompareTag("MainCamera"));
            if (mainCams != 1) Fail($"{when}：主相机有 {mainCams} 个");
            int listeners = FindObjectsByType<AudioListener>().Count(l => l.enabled);
            if (listeners != 1) Fail($"{when}：启用的音频监听有 {listeners} 个");
            var flow = SceneFlow.Instance;
            int loaded = 0;
            for (int i = 0; i < SceneManager.sceneCount; i++)
                if (SceneManager.GetSceneAt(i).isLoaded) loaded++;
            if (loaded != 2) Fail($"{when}：加载着 {loaded} 个场景（应为 Core + 关卡）");
            if (flow && SceneManager.GetActiveScene() != flow.CurrentScene)
                Fail($"{when}：活动场景是 {SceneManager.GetActiveScene().name}，不是关卡 {flow.CurrentScene.name}（光照 / 雾 / 生成物会落错场景）");
            if (flow && flow.Player != null && flow.Player.root && flow.Player.root.scene != flow.gameObject.scene)
                Fail($"{when}：玩家在 {flow.Player.root.scene.name} 场景里（应在 Core）");
            if (!Mathf.Approximately(Time.timeScale, 1)) Fail($"{when}：时间缩放 {Time.timeScale}（换关的停时间没撤掉？）");
            if (GameStateMachine.Current != GameState.Playing) Fail($"{when}：游戏状态 {GameStateMachine.Current}（应为 Playing）");
        }

        /// <summary>
        /// 武器带过来了：槽数、id、品质、强化、元素、弹匣一致；备弹不少于离关时（进关时 LootDirector 按 EconomyConfig.StageAmmoRefill 补备弹）
        /// </summary>
        static bool Carried(List<WeaponState> want, List<WeaponState> got)
        {
            if (want.Count != got.Count) return false;
            for (int i = 0; i < want.Count; i++)
            {
                var a = want[i];
                var b = got[i];
                if (a.id != b.id || a.rarity != b.rarity || a.level != b.level || a.element != b.element || a.mag != b.mag || b.reserve < a.reserve) return false;
            }
            return true;
        }

        static List<WeaponState> Snapshot(WeaponController wc)
        {
            var list = new List<WeaponState>();
            foreach (var w in wc.slots)
                if (w != null)
                    list.Add(new WeaponState { id = w.def.id, rarity = w.rarity, level = w.level, element = w.element, mag = w.mag, reserve = w.reserve });
            return list;
        }

        /// <summary>可叠两层、只加不影响生命 / 护盾 / 回复的纯属性秘卷（属性好比对、不会让生命比对失真）；没有就随便一卷能叠两层的</summary>
        static ScrollDef PickScroll()
        {
            ScrollDef fallback = null;
            foreach (var d in ScrollLibrary.All)
            {
                if (d.maxStacks < 2) continue;
                fallback ??= d;
                if (d is StatScroll s && s.stats.Length > 0 &&
                    s.stats.All(x => x.stat != Stat.MaxHp && x.stat != Stat.MaxShield && x.stat != Stat.HpRegen && x.stat != Stat.MoveSpeed))
                    return d;
            }
            return fallback ?? ScrollLibrary.All.FirstOrDefault();
        }
    }
}
