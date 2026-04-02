export const maxDuration = 120;

export async function POST() {
  return Response.json(
    {
      error: "This endpoint is deprecated. Use /api/analyze/stream for orchestrated analysis runs.",
      deprecated: true,
      supportedEndpoint: "/api/analyze/stream",
    },
    { status: 410 }
  );
}
