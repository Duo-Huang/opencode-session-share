import { Rpc } from "@opencode/plugin/rpc"

export const SessionShareRpc = Rpc.define({
  id: "opencode-session-share",
  methods: {
    prepareShare: {
      input: {
        type: "object",
        properties: { sessionID: { type: "string" } },
        required: ["sessionID"],
        additionalProperties: false,
      },
      output: {
        type: "object",
        properties: {
          consentRequired: { type: "boolean" },
          share: {
            anyOf: [
              {
                type: "object",
                properties: {
                  id: { type: "string" },
                  url: { type: "string" },
                  expiresAt: { type: "number" },
                  updatedAt: { type: "number" },
                },
                required: ["id", "url", "expiresAt"],
                additionalProperties: false,
              },
              { type: "null" },
            ],
          },
        },
        required: ["consentRequired", "share"],
        additionalProperties: false,
      },
    },
    share: {
      input: {
        type: "object",
        properties: {
          sessionID: { type: "string" },
          consent: { type: "boolean" },
        },
        required: ["sessionID"],
        additionalProperties: false,
      },
      output: {
        type: "object",
        properties: {
          id: { type: "string" },
          url: { type: "string" },
          expiresAt: { type: "number" },
        },
        required: ["id", "url", "expiresAt"],
        additionalProperties: false,
      },
    },
    unshare: {
      input: {
        type: "object",
        properties: { sessionID: { type: "string" } },
        required: ["sessionID"],
        additionalProperties: false,
      },
      output: {
        type: "object",
        properties: { revoked: { type: "boolean" } },
        required: ["revoked"],
        additionalProperties: false,
      },
    },
  },
  events: {},
})
