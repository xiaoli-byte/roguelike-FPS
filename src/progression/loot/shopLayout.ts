/** Shared, pure placement contract for the existing shop, in world metres. */
export const SHOP_ARC_RADIUS = 6.4;
export const SHOP_STALL_HALF_WIDTH = .62;
export const SHOP_CUSTOMER_HALF_WIDTH = .5;
/** Clears the axis-aligned table corners even at diagonal stalls. */
export const SHOP_COUNTER_FRONT_DISTANCE = 1.7;
const ARC_STEP = 25 * Math.PI / 180;
export interface ShopPoint { x: number; z: number }
export interface ShopStation {
  position: ShopPoint;
  /** Floor station in front of the counter, including body clearance in layout checks. */
  customer: ShopPoint;
  facing: number;
}

/** Count is 5–7 depending on available scrolls; checking all 7 reserves the largest shop. */
export function buildShopLayout(center: ShopPoint, yaw: number, count = 7, middle = 3): ShopStation[] {
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  return Array.from({ length: count }, (_, i) => {
    const angle = (i - middle) * ARC_STEP;
    const lx = Math.sin(angle) * SHOP_ARC_RADIUS, lz = -Math.cos(angle) * SHOP_ARC_RADIUS;
    const position = { x: center.x + lx * cy + lz * sy, z: center.z - lx * sy + lz * cy };
    const facing = Math.atan2(center.x - position.x, center.z - position.z);
    return { position, facing,
      customer: { x: position.x + Math.sin(facing) * SHOP_COUNTER_FRONT_DISTANCE,
        z: position.z + Math.cos(facing) * SHOP_COUNTER_FRONT_DISTANCE } };
  });
}
