import { ImageResponse } from "next/og";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

// No brand logo asset exists yet — a plain wordmark-initial icon
// (heading-gray background, matches the app's dark-pill/heading color
// token) is a reasonable placeholder until a real one is designed.
export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#111827",
          color: "#ffffff",
          fontSize: 22,
          fontWeight: 800,
          borderRadius: 6,
        }}
      >
        C
      </div>
    ),
    { ...size },
  );
}
