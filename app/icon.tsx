import { ImageResponse } from "next/og";

// Browser-tab favicon. Generated at build time from code (no image tool
// needed) so it matches components/logo.tsx exactly. Replaces the stock
// create-next-app favicon.ico, which is what was showing before.
export const size = { width: 32, height: 32 };
export const contentType = "image/png";

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
          background: "#4F46E5",
          borderRadius: 7,
        }}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
          <path d="M13 3 4 13.5h7.2L10 21l9-10.5h-7.2L13 3Z" fill="white" />
        </svg>
      </div>
    ),
    { ...size },
  );
}
