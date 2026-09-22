export const candidateSchema = {
  "type": "object",
  "properties": {
    "schemaVersion": {
      "type": "string",
      "enum": [
        "gs-hale-ai-review/1"
      ]
    },
    "findings": {
      "type": "array",
      "maxItems": 100,
      "items": {
        "type": "object",
        "properties": {
          "category": {
            "type": "string",
            "enum": [
              "YK-01",
              "YK-02",
              "YK-03",
              "YK-05",
              "YK-06",
              "YK-07",
              "YK-09",
              "YK-10",
              "YK-11",
              "YK-12",
              "TR-01",
              "EV-01"
            ]
          },
          "original": {
            "type": "object",
            "properties": {
              "segmentId": {
                "type": "string"
              },
              "start": {
                "type": "integer",
                "minimum": 0
              },
              "end": {
                "type": "integer",
                "minimum": 0
              },
              "quote": {
                "type": "string"
              }
            },
            "required": [
              "segmentId",
              "start",
              "end",
              "quote"
            ],
            "additionalProperties": false
          },
          "risk": {
            "type": "string",
            "enum": [
              "low",
              "medium",
              "high",
              "unknown"
            ]
          },
          "confidence": {
            "type": [
              "number",
              "null"
            ],
            "minimum": 0,
            "maximum": 1
          },
          "reason": {
            "type": "string",
            "maxLength": 4000
          },
          "additionalInformation": {
            "type": "array",
            "maxItems": 20,
            "items": {
              "type": "string",
              "maxLength": 1000
            }
          },
          "suggestion": {
            "type": [
              "string",
              "null"
            ],
            "maxLength": 4000
          },
          "citations": {
            "type": "array",
            "maxItems": 20,
            "items": {
              "type": "object",
              "properties": {
                "excerptId": {
                  "type": "string"
                },
                "sourceVersionId": {
                  "type": "string"
                },
                "locator": {
                  "type": "string"
                }
              },
              "required": [
                "excerptId",
                "sourceVersionId",
                "locator"
              ],
              "additionalProperties": false
            }
          }
        },
        "required": [
          "category",
          "original",
          "risk",
          "confidence",
          "reason",
          "additionalInformation",
          "suggestion",
          "citations"
        ],
        "additionalProperties": false
      }
    }
  },
  "required": [
    "schemaVersion",
    "findings"
  ],
  "additionalProperties": false
};
/** Independent validation of the exact structured-output subset; provider claims alone are insufficient. */
export function matchesSchema(value:unknown, schema:Record<string,unknown> = candidateSchema):boolean {
 const types=Array.isArray(schema.type)?schema.type:[schema.type],actual=value===null?'null':Array.isArray(value)?'array':typeof value;
 if(!types.includes(actual)&&!(types.includes('integer')&&typeof value==='number'&&Number.isSafeInteger(value)))return false;
 if(Array.isArray(schema.enum)&&!schema.enum.includes(value))return false;
 if(typeof value==='number'&&(!Number.isFinite(value)||typeof schema.minimum==='number'&&value<schema.minimum||typeof schema.maximum==='number'&&value>schema.maximum))return false;
 if(Array.isArray(value)){if(typeof schema.maxItems==='number'&&value.length>schema.maxItems)return false;return value.every(v=>matchesSchema(v,schema.items as Record<string,unknown>));}
 if(value&&typeof value==='object'){const v=value as Record<string,unknown>,props=schema.properties as Record<string,Record<string,unknown>>;if(!props)return false;if(Array.isArray(schema.required)&&schema.required.some(k=>typeof k!=='string'||!Object.hasOwn(v,k)))return false;return Object.entries(v).every(([k,n])=>!!props[k]&&matchesSchema(n,props[k]));}
 return typeof value!=='string'||value.isWellFormed();
}
