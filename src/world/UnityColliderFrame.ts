/**
 * Unity 导出的网格碰撞体（public/assets/unity-levels/meshes 里 *_Collision 的 GLB）是按世界坐标烘死的，但用的是 **Unity 坐标**
 * （x 没取反），而场景文档里的 min / max、渲染件、导航都已换成网页坐标（x 取反）。原样加进碰撞世界，每个网格碰撞都落在
 * 按 x = 0 镜像的位置上：1-2 的兜底环变成横在河道口的空气墙、佛塔 / 屋顶 / 残车在视觉位置上没有碰撞（2026-11-22 查出）。
 *
 * 这里逐个比对 GLB 顶点的 x 范围和文档的 AABB：和 (−max.x … −min.x) 对得上就是 Unity 坐标，要把 x 取反并交换三角形绕序；
 * 和 (min.x … max.x) 对得上就原样用（以后导出器改成网页坐标也不会翻两次）。纯函数，node 测试直接跑。
 */
export function colliderNeedsMirror(meshMinX: number, meshMaxX: number, docMinX: number, docMaxX: number): boolean {
  const direct = Math.abs(meshMinX - docMinX) + Math.abs(meshMaxX - docMaxX);
  const mirrored = Math.abs(-meshMaxX - docMinX) + Math.abs(-meshMinX - docMaxX);
  return mirrored + 1e-3 < direct;
}

/** 原地把顶点 x 取反、交换每个三角形的第 2、3 个索引（镜像会翻转绕序，换回来法线朝外） */
export function mirrorColliderX(positions: Float32Array, indices: Uint32Array): void {
  for (let i = 0; i < positions.length; i += 3) positions[i] = -positions[i];
  for (let i = 0; i + 2 < indices.length; i += 3) {
    const t = indices[i + 1];
    indices[i + 1] = indices[i + 2];
    indices[i + 2] = t;
  }
}
