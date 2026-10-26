import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { judgeVisionLanding } from "@/lib/vision-geometry";

const PointSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
});

const RequestSchema = z.object({
  image: z.string().regex(/^data:image\/(png|jpeg|jpg|webp);base64,/i, "Invalid image data URL"),
  mode: z.enum(["singles", "doubles"]).default("singles"),
  p1Side: z.enum(["left", "right", "top", "bottom"]).default("left"),
  // Optional court calibration: 4 normalized corners in order
  // [p1BackLeft, p1BackRight, p2BackRight, p2BackLeft] (as seen on camera).
  // When provided, in/out is judged geometrically on the server, not by the model.
  courtCorners: z.array(PointSchema).length(4).optional(),
  // Prior track for temporal consistency
  previousTrack: z
    .object({
      x: z.number().min(0).max(1),
      y: z.number().min(0).max(1),
      vx: z.number(),
      vy: z.number(),
      ageMs: z.number().min(0),
    })
    .optional(),
  lastHitter: z.enum(["p1", "p2", "unknown"]).default("unknown"),
});

const ResponseSchema = z.object({
  shuttleVisible: z.boolean(),
  position: z.object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
  }),
  landed: z.boolean(),
  call: z.enum(["in", "out", "unknown"]),
  pointTo: z.enum(["p1", "p2", "none"]),
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
});

export const Route = createFileRoute("/api/ai-vision")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { authenticateVision, readVisionBody, reserveVision } =
          await import("@/lib/vision-access.server");
        const userId = await authenticateVision(request);
        if (userId instanceof Response) return userId;
        const body = await readVisionBody(request);
        if (body instanceof Response) return body;
        const parsed = RequestSchema.safeParse(body);
        if (!parsed.success) {
          return Response.json({ error: parsed.error.message }, { status: 400 });
        }

        const { image, mode, p1Side, courtCorners, previousTrack, lastHitter } = parsed.data;
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
          return Response.json(
            { error: "OpenAI API key is not configured. Add OPENAI_API_KEY as a secret." },
            { status: 503 },
          );
        }

        const contextLines: string[] = [];
        if (courtCorners) {
          contextLines.push(
            `Court corners (normalized) provided in order p1BackLeft, p1BackRight, p2BackRight, p2BackLeft: ${courtCorners
              .map((c) => `(${c.x.toFixed(3)},${c.y.toFixed(3)})`)
              .join(
                ", ",
              )}. The server will judge in/out geometrically from your reported cork position — you MUST focus on cork localization, visibility, and landed vs mid-flight only.`,
          );
        }
        if (previousTrack) {
          contextLines.push(
            `Previous cork position ${previousTrack.ageMs}ms ago: (${previousTrack.x.toFixed(3)}, ${previousTrack.y.toFixed(3)}) moving at velocity (${previousTrack.vx.toFixed(3)}, ${previousTrack.vy.toFixed(3)}) per frame. Use this only as a sanity check — if what you see contradicts it, trust the current frame.`,
          );
        }
        if (lastHitter !== "unknown") {
          contextLines.push(
            `Last confirmed hitter: ${lastHitter}. The point should go to the OPPONENT of the last hitter when the shuttle lands out, and to the LAST HITTER when it lands in on the opponent's side.`,
          );
        }

        const reservation = await reserveVision(userId);
        if (reservation instanceof Response) return reservation;
        try {
          const openAiResponse = await fetch("https://api.openai.com/v1/responses", {
            method: "POST",
            signal: AbortSignal.any([request.signal, AbortSignal.timeout(45_000)]),
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
              model: "gpt-4o",
              temperature: 0,
              top_p: 0.1,
              instructions: [
                "You are a precise real-time badminton shuttle tracker analyzing a single live camera frame.",
                "PRIMARY TASK: Locate the shuttlecock CORK — the rounded rubber/cork tip at the heavy leading end, NOT the feather skirt. The cork is small (typically 8–20 px), often blurred by motion, and always leads flight direction. Return normalized coordinates (x 0-1 left→right, y 0-1 top→bottom) of the cork's center.",
                "If the shuttle is genuinely not visible (occluded, off-frame, indistinguishable from background), set shuttleVisible=false and position={0.5,0.5} with confidence < 0.3. Do NOT guess a position.",
                "LANDED detection: landed=true ONLY when the shuttle is stationary on the floor for this frame. Mid-flight, mid-bounce, or being caught by a player = landed=false. When landed, the cork is usually pointing up and the skirt is fanned out flat.",
                `Game mode: ${mode}. Player 1 defends the ${p1Side} side, Player 2 the opposite side.`,
                courtCorners
                  ? "In/out and pointTo will be computed geometrically by the server from your reported position. Still report your best call and pointTo for cross-checking, but the server value is authoritative."
                  : "If you can see the court boundary lines, judge in/out. If the boundary is not clear in the frame, use call='unknown'.",
                "Only set pointTo when landed=true AND confidence >= 0.7. Otherwise pointTo='none'.",
                "Confidence calibration: 0.9+ = cork clearly locatable and unambiguous. 0.7-0.9 = visible but motion-blurred or partially occluded. 0.4-0.7 = uncertain but plausible. <0.4 = guessing, prefer shuttleVisible=false.",
                "Reasoning: 1 short sentence, ≤ 100 chars.",
                ...contextLines,
              ].join(" \n"),
              input: [
                {
                  role: "user",
                  content: [
                    {
                      type: "input_text",
                      text: "Analyze this frame. Return only the JSON per schema.",
                    },
                    { type: "input_image", image_url: image, detail: "high" },
                  ],
                },
              ],
              max_output_tokens: 260,
              text: {
                format: {
                  type: "json_schema",
                  name: "shuttle_track",
                  strict: true,
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      shuttleVisible: { type: "boolean" },
                      position: {
                        type: "object",
                        additionalProperties: false,
                        properties: {
                          x: { type: "number", minimum: 0, maximum: 1 },
                          y: { type: "number", minimum: 0, maximum: 1 },
                        },
                        required: ["x", "y"],
                      },
                      landed: { type: "boolean" },
                      call: { type: "string", enum: ["in", "out", "unknown"] },
                      pointTo: { type: "string", enum: ["p1", "p2", "none"] },
                      confidence: { type: "number", minimum: 0, maximum: 1 },
                      reasoning: { type: "string" },
                    },
                    required: [
                      "shuttleVisible",
                      "position",
                      "landed",
                      "call",
                      "pointTo",
                      "confidence",
                      "reasoning",
                    ],
                  },
                },
              },
            }),
          });

          const payload = await openAiResponse.json().catch(() => ({}) as Record<string, unknown>);

          const fallback = {
            shuttleVisible: false,
            position: { x: 0.5, y: 0.5 },
            landed: false,
            call: "unknown" as const,
            pointTo: "none" as const,
            confidence: 0,
            reasoning: "",
          };

          if (!openAiResponse.ok) {
            const errorMessage =
              (payload as { error?: { message?: string } }).error?.message ||
              `OpenAI request failed (${openAiResponse.status}).`;
            console.error("ai-vision: openai non-ok", openAiResponse.status, errorMessage);
            return Response.json({ ...fallback, reasoning: errorMessage });
          }

          const text = extractOpenAiText(payload as Record<string, unknown>);
          let result: unknown;
          try {
            result = JSON.parse(text);
          } catch {
            console.error("ai-vision: invalid JSON from openai", text?.slice(0, 200));
            return Response.json({ ...fallback, reasoning: "invalid_json" });
          }

          const validated = ResponseSchema.safeParse(result);
          if (!validated.success) {
            console.error("ai-vision: bad shape", validated.error.message);
            return Response.json({ ...fallback, reasoning: "bad_shape" });
          }

          let out = validated.data;

          // Geometric override when the user has calibrated court corners: the
          // in/out call uses the lines in play, and an out is won by the player
          // whose end the shuttle landed at, whoever hit last.
          if (courtCorners && out.shuttleVisible) {
            const judged = judgeVisionLanding(out.position, courtCorners, mode);
            if (judged) {
              out = {
                ...out,
                call: judged.call,
                pointTo: out.landed && out.confidence >= 0.6 ? judged.pointTo : "none",
              };
            }
          }

          return Response.json(out);
        } catch (error) {
          const message = error instanceof Error ? error.message : "AI vision request failed.";
          console.error("ai-vision: unexpected error", message);
          return Response.json({
            shuttleVisible: false,
            position: { x: 0.5, y: 0.5 },
            landed: false,
            call: "unknown" as const,
            pointTo: "none" as const,
            confidence: 0,
            reasoning: message,
          });
        } finally {
          await reservation.release();
        }
      },
    },
  },
});

function extractOpenAiText(payload: Record<string, unknown>): string {
  if (typeof payload.output_text === "string") return payload.output_text;

  const parts: string[] = [];
  const output = Array.isArray(payload.output) ? payload.output : [];
  for (const item of output) {
    if (typeof item !== "object" || item === null) continue;
    const content = Array.isArray((item as Record<string, unknown>).content)
      ? ((item as Record<string, unknown>).content as unknown[])
      : [];
    for (const c of content) {
      if (
        typeof c === "object" &&
        c !== null &&
        typeof (c as Record<string, unknown>).text === "string"
      ) {
        parts.push((c as Record<string, unknown>).text as string);
      }
    }
  }

  return parts.join("\n").trim();
}
