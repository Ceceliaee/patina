// Test-only Russian plural fixture. It is intentionally absent from the production registry.
export const MESSAGES = {
  "fixture.cases": ["0:many", "1:one", "2:few", "5:many", "11:many", "21:one", "22:few", "25:many"],
  "fixture.cardinal": {
    "$type": "message",
    "body": {
      "$op": "plural",
      "arg": "count",
      "cases": {
          "one": { "$op": "concat", "parts": [{ "$op": "arg", "name": "count" }, ":one"] },
          "few": { "$op": "concat", "parts": [{ "$op": "arg", "name": "count" }, ":few"] },
          "many": { "$op": "concat", "parts": [{ "$op": "arg", "name": "count" }, ":many"] },
          "other": { "$op": "concat", "parts": [{ "$op": "arg", "name": "count" }, ":other"] }
      }
    }
  }
} as const;
