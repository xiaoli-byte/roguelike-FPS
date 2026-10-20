using System;
using System.Collections.Generic;
using Newtonsoft.Json.Linq;

namespace Spiritfire.Game
{
    /// <summary>
    /// 局外存档段的宽容读取（同 Three.js Meta.ts 的 sanitize）：类型不对、负数、NaN 一律当 0 / 空，不抛异常；
    /// 存档被手改坏一个字段只丢那一个字段。
    /// </summary>
    static class MetaJson
    {
        /// <summary>解析成对象；不是对象（或 json 为 null）返回 null</summary>
        public static JObject Object(string json) => json != null && SaveService.ParseToken(json) is JObject o ? o : null;

        /// <summary>非负整数（小数向下取整；同 TS nonNegInt）</summary>
        public static int NonNegInt(JToken t)
        {
            double d = Number(t);
            return d > 0 ? (int)Math.Min(int.MaxValue, Math.Floor(d)) : 0;
        }

        /// <summary>非负数</summary>
        public static double NonNeg(JToken t)
        {
            double d = Number(t);
            return d > 0 ? d : 0;
        }

        static double Number(JToken t)
        {
            if (t is not JValue v) return 0;
            double d;
            switch (v.Type)
            {
                case JTokenType.Integer:
                case JTokenType.Float:
                    try { d = Convert.ToDouble(v.Value); }
                    catch (Exception) { return 0; }
                    break;
                default:
                    return 0;
            }
            return double.IsNaN(d) || double.IsInfinity(d) ? 0 : d;
        }

        /// <summary>{ 键: 非负整数 }；值为 0 的不收</summary>
        public static Dictionary<string, int> IntMap(JToken t)
        {
            var map = new Dictionary<string, int>();
            if (t is not JObject o) return map;
            foreach (var p in o.Properties())
            {
                int n = NonNegInt(p.Value);
                if (n > 0 && !string.IsNullOrEmpty(p.Name)) map[p.Name] = n;
            }
            return map;
        }

        /// <summary>[非负整数…]（不合法的项记 0，保住下标）</summary>
        public static List<int> IntList(JToken t)
        {
            var list = new List<int>();
            if (t is not JArray a) return list;
            foreach (var x in a) list.Add(NonNegInt(x));
            return list;
        }

        /// <summary>[非空字符串…]（去重，保持顺序）</summary>
        public static List<string> StringList(JToken t)
        {
            var list = new List<string>();
            if (t is not JArray a) return list;
            foreach (var x in a)
                if (x is JValue { Type: JTokenType.String } v && v.Value is string s && s.Length > 0 && !list.Contains(s))
                    list.Add(s);
            return list;
        }

        public static JObject ToJson(Dictionary<string, int> map)
        {
            var o = new JObject();
            foreach (var (k, v) in map)
                if (v > 0)
                    o[k] = v;
            return o;
        }
    }
}
