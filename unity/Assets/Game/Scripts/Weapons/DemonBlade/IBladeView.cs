using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>左手手势：剑指（出窍 / 爆发落点）、立掌（屏障）、举手（杀气聚合）</summary>
    public enum BladeGesture { None, Point, Shield, Raise }

    /// <summary>控制器每帧交给第一人称的状态（同 TS BladePoseInput）</summary>
    public struct BladePose
    {
        /// <summary>当前挥砍段（−1 = 不在挥砍）、进度 0..1、判定帧在进度里的位置</summary>
        public int swing;
        public float swingP, hitP;
        /// <summary>这一段的伸刃倍率（第三段 2.2；人刀合一时常态 1.3）</summary>
        public float stretch;
        /// <summary>当前挥砍段的武器表条目（时长 / 判定帧 / 伸刃：第一人称按它生成三段斩剪辑）；不在挥砍时为 null</summary>
        public BladeSlash slash;
        /// <summary>人刀合一时刀身的常态伸长倍率（武器表 union.stretch，1.3）；乘 <see cref="union"/> 生效</summary>
        public float unionStretch;
        public BladeGesture gesture;
        /// <summary>人刀合一强度 0..1、鬼眼 0..1、刃气 0..1</summary>
        public float union, eye, qi;
        /// <summary>切枪收放 0..1（1 = 完全收下）</summary>
        public float lower;
    }

    /// <summary>
    /// 碎刃的第一人称表现（WC7 的 BladeView 实现它；之前用 <see cref="BladePlaceholderView"/>）。
    /// 控制器只通过这里驱动画面：每帧给姿态与刃群（哪些碎片在手里），刃群从 <see cref="IShardHome.HomeWorld"/> 出发、回到那里。
    /// 换实现：设 <see cref="DemonBladeController.ViewFactory"/>。
    /// </summary>
    public interface IBladeView : IShardHome
    {
        /// <summary>底层物体还在（场景切换可能把相机连同视图一起销毁）</summary>
        bool Alive { get; }
        void Show(bool on);
        /// <summary>每帧：姿态生效后摆碎片（shards.InHand 决定哪片显示）、鬼眼、刀光</summary>
        void Animate(float dt, in BladePose pose, BladeShards shards);
        /// <summary>刀根鬼面的世界坐标（主相机空间对齐后；噬灵魔气飞向这里）</summary>
        Vector3 RootWorld { get; }
        /// <summary>开始第 index 段挥砍</summary>
        void OnSlash(int index);
        /// <summary>判定帧（不论打没打中）：刀光</summary>
        void OnStrike(int index, BladeSlash seg, bool union);
        /// <summary>这一段打中了东西：命中闪光</summary>
        void OnHit(bool heavy);
        void Dispose();
    }
}
