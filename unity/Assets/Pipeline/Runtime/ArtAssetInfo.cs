using UnityEngine;

namespace Spiritfire.Art
{
    /// <summary>
    /// 美术 Prefab 的身份证：由 Spiritfire ▸ Art ▸ Sync 按 *.art.json 生成，记录资产 ID、规格档、骨骼类型与来源。
    /// 玩法代码按 <see cref="bindSource"/> / <see cref="bindId"/> / <see cref="bindAttachment"/> 找到要挂的美术资产，
    /// 与 Three.js 版 manifest.json 的 bind 字段同义。
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class ArtAssetInfo : MonoBehaviour
    {
        public string assetId;
        public string assetClass;
        public string category;
        [Tooltip("humanoid / generic / none")] public string rigType;
        public string bindSource;
        public string bindId;
        public string bindAttachment;
        public float[] lodDistance;
        [Tooltip("Move 片段录制时的移动速度（米/秒）；Animator 的 MoveScale = 实际速度 / 它")] public float moveSpeed;
        public Bounds designBounds;
        public string sourceGlb;
        public string sourceSha256;
        [TextArea] public string license;
    }
}
