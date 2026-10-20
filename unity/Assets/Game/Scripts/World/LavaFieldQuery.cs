using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 把 <see cref="LavaField"/> 接到第三章敌人用的熔岩查询接口 <see cref="InfernoKit.Lava"/>（火鼍潜游、祸斗吃熔岩边、炭童、马面拖拽）：
    /// 场景里有熔岩体时由它回答，没有时退回 InfernoKit 自带的「没有熔岩」。查询都走 LavaField 的几何表，不打射线。
    /// </summary>
    public sealed class LavaFieldQuery : ILavaQuery
    {
        public static readonly LavaFieldQuery Instance = new();

        public bool IsLava(Vector3 p) => LavaField.IsLavaAt(p);

        public float SurfaceY(Vector3 p) => LavaField.SurfaceHeight(p);

        public bool NearestLava(Vector3 from, float radius, out Vector3 lava) => LavaField.NearestLava(from, radius, out lava, out _);

        public bool ShoreToward(Vector3 from, Vector3 toward, float maxDist, out Vector3 bank)
        {
            bool ok = LavaField.BankToward(from, toward, out bank, maxDist);
            if (ok) bank.y = from.y;
            return ok;
        }

        // 场景加载前挂上：InfernoKit 每次取 Lava 时，有熔岩体就用 LavaField，没有就是它自己的兜底
        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.BeforeSceneLoad)]
        static void Install() => InfernoKit.LavaProvider = () => LavaField.Any ? Instance : null;
    }
}
