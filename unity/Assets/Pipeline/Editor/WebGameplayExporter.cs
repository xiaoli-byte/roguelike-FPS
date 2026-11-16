using System;
using System.IO;
using System.Linq;
using System.Reflection;
using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using Newtonsoft.Json.Linq;
using Newtonsoft.Json.Serialization;
using Spiritfire.Game;
using UnityEngine;

namespace Spiritfire.Art.Editor
{
    /// <summary>
    /// 网页迁移用的玩法定义表：public/assets/unity-gameplay/defs.json（docs/threejs-migration.md M2）。
    /// 英雄 / 敌人 / 武器 / 首领的定义对象整份序列化：公开字段 + 只读属性（如 spreadHip、WeakHeight 这类按规则算出的值），
    /// 枚举写名字，Unity 值类型写成数组，System.Type 写类名。早先用 JsonUtility，它会悄悄丢掉
    /// 可空结构（spreadTuned）、引用类型字段（projectile、blade、innate）和只读列表（首领 tiers / phases），枚举还成了整数。
    /// </summary>
    public static class WebGameplayExporter
    {
        const string OutputDir = "../public/assets/unity-gameplay";

        public static void ExportAll()
        {
            Directory.CreateDirectory(OutputDir);
            var serializer = JsonSerializer.Create(Settings());
            JArray Dump<T>(System.Collections.Generic.IEnumerable<T> items) => new(items.Select(item => JToken.FromObject(item, serializer)));
            var document = new JObject
            {
                ["schema"] = 2,
                ["heroes"] = Dump(HeroLibrary.All),
                ["enemies"] = Dump(EnemyRoster.All),
                ["weapons"] = Dump(WeaponLibrary.All),
                ["bosses"] = Dump(Bosses.All),
            };
            File.WriteAllText(Path.Combine(OutputDir, "defs.json"), document.ToString(Formatting.Indented));
            Debug.Log($"[WebGameplay] {document["heroes"].Count()} heroes, {document["enemies"].Count()} enemies, {document["weapons"].Count()} weapons, {document["bosses"].Count()} bosses");
        }

        static JsonSerializerSettings Settings() => new()
        {
            ContractResolver = new FieldsAndReadOnlyProperties(),
            Converters = { new StringEnumConverter(), new UnityValueConverter(), new TypeNameConverter() },
            ReferenceLoopHandling = ReferenceLoopHandling.Ignore,
            NullValueHandling = NullValueHandling.Include,
            // 个别只读属性在编辑器里取值会抛（依赖运行时单例）：跳过那一项，不让整份导出失败
            Error = (_, e) => e.ErrorContext.Handled = true,
        };

        /// <summary>公开实例字段 + 有 getter 的公开实例属性；跳过索引器和 UnityEngine.Object 引用。</summary>
        sealed class FieldsAndReadOnlyProperties : DefaultContractResolver
        {
            protected override System.Collections.Generic.IList<JsonProperty> CreateProperties(Type type, MemberSerialization memberSerialization)
            {
                var members = type.GetFields(BindingFlags.Public | BindingFlags.Instance).Cast<MemberInfo>()
                    .Concat(type.GetProperties(BindingFlags.Public | BindingFlags.Instance).Where(p => p.CanRead && p.GetIndexParameters().Length == 0));
                var list = new System.Collections.Generic.List<JsonProperty>();
                foreach (var member in members)
                {
                    var valueType = member is FieldInfo f ? f.FieldType : ((PropertyInfo)member).PropertyType;
                    if (typeof(UnityEngine.Object).IsAssignableFrom(valueType) || typeof(Delegate).IsAssignableFrom(valueType)) continue;
                    var property = CreateProperty(member, memberSerialization);
                    property.Readable = true;
                    property.Writable = false;
                    property.Ignored = false;
                    if (list.Any(p => p.PropertyName == property.PropertyName)) continue;
                    list.Add(property);
                }
                return list;
            }
        }

        sealed class UnityValueConverter : JsonConverter
        {
            public override bool CanConvert(Type t) =>
                t == typeof(Vector2) || t == typeof(Vector3) || t == typeof(Vector4) || t == typeof(Vector2Int) || t == typeof(Vector3Int)
                || t == typeof(Color) || t == typeof(Quaternion) || t == typeof(AnimationCurve);

            public override void WriteJson(JsonWriter writer, object value, JsonSerializer serializer)
            {
                JToken token = value switch
                {
                    Vector2 v => new JArray(v.x, v.y),
                    Vector3 v => new JArray(v.x, v.y, v.z),
                    Vector4 v => new JArray(v.x, v.y, v.z, v.w),
                    Vector2Int v => new JArray(v.x, v.y),
                    Vector3Int v => new JArray(v.x, v.y, v.z),
                    Color c => new JArray(c.r, c.g, c.b, c.a),
                    Quaternion q => new JArray(q.x, q.y, q.z, q.w),
                    AnimationCurve curve => new JArray(curve.keys.Select(k => new JArray(k.time, k.value, k.inTangent, k.outTangent))),
                    _ => JValue.CreateNull(),
                };
                token.WriteTo(writer);
            }

            public override object ReadJson(JsonReader reader, Type objectType, object existingValue, JsonSerializer serializer) =>
                throw new NotSupportedException();
        }

        sealed class TypeNameConverter : JsonConverter
        {
            public override bool CanConvert(Type t) => typeof(Type).IsAssignableFrom(t);
            public override void WriteJson(JsonWriter writer, object value, JsonSerializer serializer) => writer.WriteValue(((Type)value)?.Name);
            public override object ReadJson(JsonReader reader, Type objectType, object existingValue, JsonSerializer serializer) =>
                throw new NotSupportedException();
        }
    }
}
