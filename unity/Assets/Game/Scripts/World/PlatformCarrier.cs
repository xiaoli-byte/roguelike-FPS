using System.Collections.Generic;
using Spiritfire.Art;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 会动、能站人的台面的载人核心（L6；通用件 <see cref="MovingPlatform"/> 与 3-2 的 <see cref="ForgeWellLift"/> 共用）。对角色控制器安全的做法：
    ///   · 乘客 = 台面上方一层薄盒子（台面顶 −0.1 … +0.6 m，四边各收 0.1 m）里的角色控制器（只有玩家有）；跳高了的不算。
    ///   · 台面挂运动学刚体：SafeGround 不会把会动的台面记成安全落脚点。
    ///   · 往上：先用 CharacterController.Move 把乘客抬起、再挪台面；往下：先挪台面、再把乘客按同样的位移放下——乘客始终贴着台面。
    ///     用它的组件排在 PlayerMotor 之前更新（DefaultExecutionOrder −30）：PlayerMotor 这一帧照常走、照常判落地，台面的位移不进它的速度（到站不会被甩出去）。
    ///     乘客的位移全是扫掠的 Move，不会被瞬移进地面；PlayerMotor 的防穿地（帧初 → 帧末之间穿过一层朝上的地面才托回）拿到的帧初位置
    ///     已经是平台挪完之后的，下降的台面不会触发误救。
    ///   · 往下走时台面底下（这一步扫过的空间）有角色就停住等（不压人）。
    ///   · 两项只在通用件里打开（<see cref="Step"/>；ForgeWellLift 走老路 <see cref="SomethingBelow"/> + <see cref="MoveRiders"/>，行为不变）：
    ///     往上时乘客头顶被挡就停住（不把人挤进天花板）；横着走时把挡在台面前进方向上的玩家一起推开（扫掠 Move），推不动就停住（不把人夹进墙里）。
    ///     敌人（导航代理，不是角色控制器）横着不推：台面穿过它们的胶囊不产生物理反应；往下照样会停住等它们走开。
    /// </summary>
    public sealed class PlatformCarrier
    {
        public enum Result { Moved, BlockedBelow, BlockedAbove, BlockedSide }

        /// <summary>台面：物体位置 = 台面顶面中心（碰撞盒在它下面）</summary>
        public readonly Transform deck;
        /// <summary>台面尺寸（米，台面局部 X 宽 × Z 深）与厚度：载人 / 压人 / 推人检测按它</summary>
        public Vector2 size;
        public float thickness;

        readonly Rigidbody body;
        readonly List<CharacterController> riders = new();
        static readonly Collider[] hits = new Collider[16];

        public PlatformCarrier(Transform deck, Vector2 size, float thickness)
        {
            this.deck = deck;
            this.size = size;
            this.thickness = thickness;
            body = deck.GetComponent<Rigidbody>();
            if (!body) body = deck.gameObject.AddComponent<Rigidbody>();
            body.isKinematic = true;
            body.useGravity = false;
            body.interpolation = RigidbodyInterpolation.None;
        }

        /// <summary>台面上的乘客（本帧 <see cref="CollectRiders"/> 的结果）</summary>
        public IReadOnlyList<CharacterController> Riders => riders;

        /// <summary>这个角色控制器现在站在台面上</summary>
        public bool Carrying(CharacterController cc) => cc && riders.Contains(cc);

        /// <summary>挡住上一步的是玩家（下面站着 / 头顶被挡的乘客 / 推不动的玩家）</summary>
        public bool PlayerBlocking { get; private set; }

        public void SetDeck(Vector3 p)
        {
            deck.position = p;
            if (body) body.position = p;
            Physics.SyncTransforms();
        }

        public void MoveRiders(Vector3 delta)
        {
            foreach (var cc in riders)
                if (cc && cc.enabled && cc.gameObject.activeInHierarchy)
                    cc.Move(delta);
        }

        /// <summary>台面上方一层薄薄的盒子里的角色控制器 = 乘客（跳在半空的不算）</summary>
        public void CollectRiders()
        {
            riders.Clear();
            var half = new Vector3(Mathf.Max(0.1f, size.x * 0.5f - 0.1f), 0.35f, Mathf.Max(0.1f, size.y * 0.5f - 0.1f));
            int n = Physics.OverlapBoxNonAlloc(deck.position + Vector3.up * 0.25f, half, hits, deck.rotation, 1 << Layers.Character, QueryTriggerInteraction.Ignore);
            for (int i = 0; i < n; i++)
                if (hits[i] is CharacterController cc && cc.enabled && !riders.Contains(cc))
                    riders.Add(cc);
        }

        /// <summary>下行这一步扫过的空间（台面底下）里有没有角色；playerBelow = 其中有玩家</summary>
        public bool SomethingBelow(float drop, out bool playerBelow)
        {
            var half = new Vector3(Mathf.Max(0.1f, size.x * 0.5f - 0.05f), drop * 0.5f + 0.06f, Mathf.Max(0.1f, size.y * 0.5f - 0.05f));
            var c = deck.position + Vector3.down * (thickness + drop * 0.5f + 0.06f);
            int n = Physics.OverlapBoxNonAlloc(c, half, hits, deck.rotation, 1 << Layers.Character, QueryTriggerInteraction.Ignore);
            playerBelow = false;
            for (int i = 0; i < n && !playerBelow; i++)
                playerBelow = hits[i] && hits[i].GetComponentInParent<PlayerMotor>();
            return n > 0;
        }

        /// <summary>
        /// 通用的一步（先 <see cref="CollectRiders"/>）：下面有人 / 乘客头顶被挡 / 前面的玩家推不动就不动，返回挡住的原因；
        /// 否则推开前面的玩家、按「往上先抬乘客、往下先挪台面」挪一步。
        /// </summary>
        public Result Step(Vector3 delta)
        {
            PlayerBlocking = false;
            if (delta.y < 0 && SomethingBelow(-delta.y, out bool below))
            {
                PlayerBlocking = below;
                return Result.BlockedBelow;
            }
            if (delta.y > 0 && RiderHeadBlocked(delta.y))
            {
                PlayerBlocking = true;
                return Result.BlockedAbove;
            }
            var flat = new Vector3(delta.x, 0, delta.z);
            if (flat.sqrMagnitude > 1e-8f && !PushAside(flat))
            {
                PlayerBlocking = true;
                return Result.BlockedSide;
            }
            var pos = deck.position;
            if (delta.y >= 0)
            {
                MoveRiders(delta);
                SetDeck(pos + delta);
            }
            else
            {
                SetDeck(pos + delta);
                MoveRiders(delta);
            }
            return Result.Moved;
        }

        /// <summary>有乘客往上抬 dy 会顶到世界几何（胶囊往上扫）</summary>
        bool RiderHeadBlocked(float dy)
        {
            foreach (var cc in riders)
            {
                if (!cc || !cc.enabled || !cc.gameObject.activeInHierarchy) continue;
                var t = cc.transform;
                var center = t.TransformPoint(cc.center);
                float r = cc.radius * Mathf.Max(Mathf.Abs(t.lossyScale.x), Mathf.Abs(t.lossyScale.z));
                float half = Mathf.Max(0, cc.height * Mathf.Abs(t.lossyScale.y) * 0.5f - r);
                var a = center - Vector3.up * half;
                var b = center + Vector3.up * half;
                if (Physics.CapsuleCast(a, b, r * 0.95f, Vector3.up, out _, dy + cc.skinWidth, Layers.WorldMask, QueryTriggerInteraction.Ignore)) return true;
            }
            return false;
        }

        /// <summary>
        /// 台面板身挪到下一步的位置会撞上的玩家（不算乘客）：先按水平位移推开（扫掠 Move）。推不动（被墙夹住）返回 false，台面这一步不动
        /// </summary>
        bool PushAside(Vector3 flat)
        {
            float len = flat.magnitude;
            var half = new Vector3(size.x * 0.5f, Mathf.Max(0.05f, thickness * 0.5f - 0.03f), size.y * 0.5f);
            var c = deck.position + flat + Vector3.down * (thickness * 0.5f + 0.02f);
            int n = Physics.OverlapBoxNonAlloc(c, half, hits, deck.rotation, 1 << Layers.Character, QueryTriggerInteraction.Ignore);
            for (int i = 0; i < n; i++)
            {
                if (!(hits[i] is CharacterController cc) || !cc.enabled || riders.Contains(cc)) continue;
                var before = cc.transform.position;
                cc.Move(flat);
                var moved = cc.transform.position - before;
                if (Vector3.Dot(moved, flat / len) < len * 0.8f - 1e-4f) return false;
            }
            return true;
        }
    }
}
