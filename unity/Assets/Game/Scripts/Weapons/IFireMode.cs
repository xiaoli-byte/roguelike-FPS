namespace Spiritfire.Game
{
    /// <summary>
    /// 开火模式每帧的输入（由 <see cref="WeaponStateMachine"/> 组装）。
    /// ready = 不在切枪、不在换弹、活着；blocked = 冲刺中（Unity 手感：冲刺时不开火，蓄力 / 预热不受影响）。
    /// </summary>
    public struct FireInput
    {
        public float dt;
        /// <summary>扳机按住（已经过输入权判断）</summary>
        public bool down;
        /// <summary>
        /// 「扣了一下」：开火缓冲里（按下后 <see cref="WeaponTiming.FireBuffer"/> 秒内）或按住但这次按压还没打出过。
        /// 半自动 / 点射 / 齐射看它；打出后调 <see cref="IFireHost.ConsumeTrigger"/>
        /// </summary>
        public bool pulled;
        public bool ready, blocked;
        /// <summary>有输入权（蓄力松手要求：暂停 / 弹窗时松开不算松手，作废）</summary>
        public bool inputOk;
        /// <summary>实际射速（每秒发 / 轮 / 跳）与相对定义的射速倍率（点射间隔、预热、蓄力都按它缩放）</summary>
        public float rate, rateMult;
        /// <summary>TestMode：按住扳机时点射 / 齐射自动连发、蓄力满了自动松手（套件只对 Semi 一下一下扣，其余一直按住）</summary>
        public bool testAuto;

        /// <summary>能打出这一发：ready 且没被冲刺挡住</summary>
        public readonly bool CanShoot => ready && !blocked;
    }

    /// <summary>
    /// 单次射击的修饰（同 TS ShotMods）：蓄力倍率、满蓄穿透、满蓄引爆、反馈强度；开火钩子再乘上传说倍率、加上强制暴击。
    /// deferred = 齐射的「扣扳机」：只扣弹、计数、发事件，弹体由 <see cref="IFireHost.VolleyProjectile"/> 逐枚发出。
    /// </summary>
    public struct ShotMods
    {
        public float mult;
        public int pierceBonus;
        public bool full;
        /// <summary>反馈强度 0..1：后坐、屏震、曳光</summary>
        public float strength;
        public bool deferred;
        /// <summary>本发必定暴击（传说「天命」，由 <see cref="WeaponRuntime.BeginShot"/> 填）</summary>
        public bool forceCrit;

        public static readonly ShotMods None = new() { mult = 1, strength = 1 };
        public static readonly ShotMods Volley = new() { mult = 1, strength = 1, deferred = true };
    }

    /// <summary>模式发出的提示音（宿主映射成音效）</summary>
    public enum FireCue
    {
        /// <summary>机炮开始预热</summary>
        SpinUp,
        /// <summary>开始蓄力</summary>
        ChargeStart,
        /// <summary>蓄满</summary>
        ChargeFull,
    }

    /// <summary>
    /// 开火模式的宿主（<see cref="WeaponStateMachine"/>，测试里是假宿主）：射击冷却是控制器级的一个数（切枪时按武器存 readyAt），
    /// 模式只决定「什么时候打、打几发、每发怎么修饰」，扣弹、弹道、反馈、事件都在宿主。
    /// </summary>
    public interface IFireHost
    {
        /// <summary>无限弹药或弹匣有弹</summary>
        bool HasAmmo { get; }
        /// <summary>射击冷却（秒）；宿主每帧先减 dt、模式之后把负数钳回 0（所以补发只追当帧的欠账）</summary>
        float Cooldown { get; set; }
        /// <summary>吃掉这次扣扳机（清开火缓冲、标记按住已打出）</summary>
        void ConsumeTrigger();
        /// <summary>一次射击：扣弹、元素轮转、弹道（deferred 时不发）、反馈、事件</summary>
        void Shoot(in ShotMods mods);
        /// <summary>齐射中的第 index 枚（共 count 枚；弹药已在 deferred 的 Shoot 里扣）；feedback = 这一枚要不要后坐 / 音效</summary>
        void VolleyProjectile(int index, int count, bool feedback);
        void Cue(FireCue cue);
    }

    /// <summary>
    /// 开火模式（同 TS WeaponSystem 的 semi / auto / burst / beam / spinup / charge，外加把 projectile.count &gt; 1 的齐射独立成一种）。
    /// 每把枪一个实例（状态跟着枪走），由 <see cref="FireModes.Create"/> 按定义选。实现只依赖 Mathf，EditMode 可测。
    /// </summary>
    public interface IFireMode
    {
        /// <summary>semi / auto / burst / beam / spinup / charge / volley</summary>
        string Id { get; }
        void Tick(in FireInput input, IFireHost host);
        /// <summary>换弹开始：点射剩余作废、光束熄灭（预热 / 蓄力由下一帧 ready = false 自然处理）</summary>
        void Cancel();
        /// <summary>切枪 / 拾取替换 / 死亡 / 换关：flush = 齐射剩下的弹体立即打完（弹药已扣），其余状态清零</summary>
        void Stop(IFireHost host, bool flush);
        /// <summary>点射 / 齐射进行中（不换弹、不自动换弹）</summary>
        bool Busy { get; }
        /// <summary>持续动作中（光束放电、机炮转满开火、蓄力中）：第一人称颤动、HUD</summary>
        bool Firing { get; }
        /// <summary>蓄力进度 0..1（不在蓄力为 0）</summary>
        float Charge { get; }
        /// <summary>转速 / 热度 0..1：机炮预热；蓄力武器的线圈（跟随蓄力，松手后 0.6 s 转停）</summary>
        float Spin { get; }
        /// <summary>当前移速惩罚（米 / 秒，正数）：机炮开火时 = def.moveSlow</summary>
        float MoveSlow { get; }
    }
}
