using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 两骨 IK（肩 → 肘 → 手，余弦定理解析解；纯函数，EditMode 可测）。第一人称手臂是一整块刚体网格（前臂 + 手），
    /// 所以这里只解出肘的位置，<see cref="WeaponHandRig"/> 让前臂沿「手 → 肘」摆过去：手按在握点 / 送弹口上，前臂跟着自然转，
    /// 而不是整条手臂平移（Three.js 版是整块平移）。
    /// </summary>
    public static class TwoBoneIK
    {
        /// <summary>
        /// 肘的位置：root = 肩，target = 手的目标，upper / lower = 上臂 / 前臂长，pole = 肘往哪边弯（提示点）。
        /// 够不着（太远 / 太近）时把距离夹到可达范围（手臂伸直 / 折到底），reached = false
        /// </summary>
        public static Vector3 Solve(Vector3 root, Vector3 target, float upper, float lower, Vector3 pole, out bool reached)
        {
            upper = Mathf.Max(1e-4f, upper);
            lower = Mathf.Max(1e-4f, lower);
            var toTarget = target - root;
            float dist = toTarget.magnitude;
            float maxReach = upper + lower - 1e-4f, minReach = Mathf.Abs(upper - lower) + 1e-4f;
            reached = dist <= maxReach && dist >= minReach;
            float d = Mathf.Clamp(dist, minReach, maxReach);
            var dir = dist > 1e-6f ? toTarget / dist : Vector3.forward;
            // 肘在「肩 → 手」连线上的投影距离与离线高度
            float along = (upper * upper - lower * lower + d * d) / (2 * d);
            float h = Mathf.Sqrt(Mathf.Max(0, upper * upper - along * along));
            var bend = Vector3.ProjectOnPlane(pole - root, dir);
            if (bend.sqrMagnitude < 1e-10f) bend = Vector3.ProjectOnPlane(Vector3.down, dir);
            if (bend.sqrMagnitude < 1e-10f) bend = Vector3.ProjectOnPlane(Vector3.right, dir);
            return root + dir * along + bend.normalized * h;
        }

        /// <summary>
        /// 刚体前臂的朝向：handRot 是手型（握持横滚 / 俯仰），forearm 是网格局部的「手 → 肘」方向；
        /// 把前臂从手型给的方向转到真正指向肘的方向（最短转动，保留手腕的扭转）
        /// </summary>
        public static Quaternion ForearmRotation(Quaternion handRot, Vector3 forearm, Vector3 hand, Vector3 elbow)
        {
            var want = elbow - hand;
            var have = handRot * forearm;
            if (want.sqrMagnitude < 1e-10f || have.sqrMagnitude < 1e-10f) return handRot;
            return Quaternion.FromToRotation(have, want) * handRot;
        }
    }
}
