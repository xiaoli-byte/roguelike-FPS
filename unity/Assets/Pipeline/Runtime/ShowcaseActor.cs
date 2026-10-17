using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Art
{
    /// <summary>
    /// 展示场景里的角色演示，一个周期：待机 → 绕一个小圈走回原位（有 Move 片段时）→ 出招（每个周期轮到下一招）→ 受击。
    /// 原生骨架敌人用从 Three.js 版采样来的专属招式（触发器 act_&lt;状态&gt;），英雄的亮相是 act_Show，Mixamo 人形是 Attack。
    /// 所有角色都能受击闪白（MaterialPropertyBlock 写 _FlashAmount，不复制材质；闪白期间该渲染器退出 SRP Batcher，结束后清掉）。
    /// Animator 参数约定：Speed（米/秒）、MoveScale（Move 片段播放倍速 = 实际速度 / 录制速度）、Hit（触发）、act_*（触发）。
    /// </summary>
    public sealed class ShowcaseActor : MonoBehaviour
    {
        public enum Mode { Idle, Cycle }

        public Mode mode = Mode.Cycle;
        public float cycleSeconds = 10f;
        [Tooltip("走圈半径（米）；0 = 按体型自动")] public float walkRadius;
        [Tooltip("受击闪白的衰减时间（秒）")] public float flashDecay = 0.18f;

        // 周期内的节拍（占比）
        const float WalkStart = 0.18f, WalkEnd = 0.5f, ActAt = 0.56f, HitAt = 0.86f;

        static readonly int SpeedId = Animator.StringToHash("Speed");
        static readonly int MoveScaleId = Animator.StringToHash("MoveScale");
        static readonly int HitId = Animator.StringToHash("Hit");
        static readonly int FlashId = Shader.PropertyToID("_FlashAmount");

        public Transform lookTarget;
        [Tooltip("每几个周期演示一次死亡（布娃娃），0 = 不演示")] public int deathEvery = 3;

        Animator animator;
        CreatureRig rig;
        CreatureRagdoll ragdoll;
        int cycleIndex = -1;
        Renderer[] renderers;
        MaterialPropertyBlock block;
        Vector3 home;
        Quaternion homeRot;
        float hover;
        static readonly RaycastHit[] Hits = new RaycastHit[8];
        float t, flash, clipSpeed, radius;
        int lastBeat = -1, actIndex;
        bool canWalk;
        int[] actions = new int[0];

        void Awake() => Init();

        bool inited;

        /// <summary>Awake 时调用；编辑器里逐帧模拟（不进 Play 模式）时由模拟器手动调用</summary>
        public void Init()
        {
            if (inited) return;
            inited = true;
            animator = GetComponentInChildren<Animator>();
            rig = GetComponentInChildren<CreatureRig>();
            ragdoll = GetComponent<CreatureRagdoll>();
            if (!lookTarget && Camera.main) lookTarget = Camera.main.transform;
            if (rig) { rig.lookTarget = lookTarget; rig.autoTick = Application.isPlaying; }
            renderers = GetComponentsInChildren<Renderer>(true);
            block = new MaterialPropertyBlock();
            home = transform.position;
            homeRot = transform.rotation;
            hover = home.y - GroundY(home);
            t = Random.value * cycleSeconds * 0.15f;
            var info = GetComponent<ArtAssetInfo>();
            clipSpeed = info ? info.moveSpeed : 0f;
            float width = info ? Mathf.Max(info.designBounds.size.x, info.designBounds.size.z) : 1f;
            radius = walkRadius > 0 ? walkRadius : Mathf.Clamp(width * 0.55f, 0.5f, 2f);
            if (animator && animator.runtimeAnimatorController)
            {
                var acts = new List<int>();
                bool hasMoveScale = false, hasSpeed = false;
                foreach (var p in animator.parameters)
                {
                    if (p.type == AnimatorControllerParameterType.Trigger && (p.name.StartsWith("act_") || p.name == "Attack")) acts.Add(p.nameHash);
                    if (p.nameHash == MoveScaleId) hasMoveScale = true;
                    if (p.nameHash == SpeedId) hasSpeed = true;
                }
                actions = acts.ToArray();
                // 原生骨架状态机有 Move 才有 MoveScale；Mixamo 人形状态机（没有 MoveScale）靠 Speed 混合走路
                canWalk = hasMoveScale || (hasSpeed && clipSpeed <= 0 && animator.isHuman);
                if (clipSpeed <= 0) clipSpeed = 1.6f;
            }
        }

        public void Flash() => flash = 1f;

        /// <summary>脚下地面高度（跳过角色层）：根节点像角色控制器一样贴着地面走，悬浮角色保持离地高度</summary>
        float GroundY(Vector3 p)
        {
            int mask = ~LayerMask.GetMask("Character", "FirstPerson");
            int n = Physics.RaycastNonAlloc(p + Vector3.up * 2f, Vector3.down, Hits, 6f, mask, QueryTriggerInteraction.Ignore);
            float best = float.NegativeInfinity;
            for (int i = 0; i < n; i++) best = Mathf.Max(best, Hits[i].point.y);
            return n > 0 ? best : p.y;
        }

        void SnapToGround()
        {
            var p = transform.position;
            p.y = GroundY(p) + hover;
            transform.position = p;
        }

        /// <summary>受击：闪白 + 方向性受击（从镜头方向打过来）</summary>
        public void Hit(float strength)
        {
            Flash();
            if (rig && lookTarget) rig.Hit(transform.position - lookTarget.position, strength);
        }

        public bool IsDead => ragdoll && ragdoll.Active;

        public void Kill()
        {
            if (!ragdoll || ragdoll.Active) return;
            var from = lookTarget ? lookTarget.position : transform.position - transform.forward;
            var chest = transform.position + Vector3.up * 1f;
            ragdoll.Activate((chest - from).normalized * 40f + Vector3.up * 10f, chest);
        }

        public void Respawn()
        {
            if (ragdoll && ragdoll.Active) ragdoll.Restore();
            transform.SetPositionAndRotation(home, homeRot);
            var loco = GetComponent<CreatureLocomotion>();
            if (loco) loco.Teleported();
        }

        void Update()
        {
            if (Application.isPlaying) Tick(Time.deltaTime);
        }

        /// <summary>推进演示：Play 模式里由 Update 调用；编辑器模拟时手动调用，之后再推进 Animator 与 CreatureRig</summary>
        public void Tick(float dt)
        {
            Init();
            t += dt;
            int cyc = Mathf.FloorToInt(t / cycleSeconds);
            if (cyc != cycleIndex)
            {
                // 新周期：上一轮死了就在原位复活
                if (ragdoll && ragdoll.Active) Respawn();
                cycleIndex = cyc;
            }
            bool deathCycle = deathEvery > 0 && ragdoll && cyc % deathEvery == deathEvery - 1;
            if (ragdoll && ragdoll.Active) return;
            if (mode == Mode.Cycle)
            {
                float u = (t % cycleSeconds) / cycleSeconds;
                // 走圈：从原位出发、绕一个圆回到原位，朝向沿切线；圆的大小按体型
                if (canWalk && u >= WalkStart && u < WalkEnd)
                {
                    float dur = (WalkEnd - WalkStart) * cycleSeconds;
                    float a = (u - WalkStart) / (WalkEnd - WalkStart) * Mathf.PI * 2f;
                    var local = new Vector3(Mathf.Sin(a), 0, 1 - Mathf.Cos(a)) * radius;
                    var tangent = new Vector3(Mathf.Cos(a), 0, Mathf.Sin(a));
                    transform.position = home + homeRot * local;
                    transform.rotation = Quaternion.LookRotation(homeRot * tangent, Vector3.up);
                    SnapToGround();
                }
                else
                {
                    // 走完回到原位，缓缓转回原来的朝向
                    transform.position = Vector3.Lerp(transform.position, home, 1 - Mathf.Exp(-10 * dt));
                    SnapToGround();
                    transform.rotation = Quaternion.Slerp(transform.rotation, homeRot, 1 - Mathf.Exp(-5 * dt));
                }
                int beat = u < ActAt ? 0 : u < HitAt ? 1 : 2;
                if (beat != lastBeat)
                {
                    if (beat == 1 && actions.Length > 0) animator.SetTrigger(actions[actIndex++ % actions.Length]);
                    if (beat == 2)
                    {
                        if (deathCycle) { Kill(); return; }
                        // 轻重交替：重击时也触发采样来的受击片段，轻击只有程序化的方向性受击
                        bool heavy = cyc % 2 == 1;
                        if (heavy && animator && animator.runtimeAnimatorController) animator.SetTrigger(HitId);
                        Hit(heavy ? 0.9f : 0.35f);
                    }
                    lastBeat = beat;
                }
            }
            // Speed / MoveScale / 转弯倾斜由 CreatureLocomotion 按根节点的实际运动推导（这里只管移动）

            if (flash > 0f)
            {
                flash = Mathf.Max(0f, flash - dt / Mathf.Max(0.01f, flashDecay));
                foreach (var r in renderers)
                {
                    if (flash <= 0f) { r.SetPropertyBlock(null); continue; }
                    r.GetPropertyBlock(block);
                    block.SetFloat(FlashId, flash * flash);
                    r.SetPropertyBlock(block);
                }
            }
        }
    }
}
