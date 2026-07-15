// Next.js 16 renamed "Middleware" to "Proxy" (same mechanism, file must be
// named proxy.ts with a `proxy` export — middleware.ts/`middleware` is
// deprecated). See node_modules/next/dist/docs/01-app/01-getting-started/16-proxy.md.
import { NextResponse, type NextRequest } from "next/server";
import { geolocation } from "@vercel/functions";
import { CITY_COOKIE } from "./lib/cookies";
import { matchCityByGeoName } from "./lib/cities";

export function proxy(request: NextRequest): NextResponse {
  const response = NextResponse.next();

  // Silent SSR default from IP geolocation — only set once; the manual
  // city selector overrides it client-side afterward and this proxy must
  // never clobber that explicit choice on a later request.
  if (!request.cookies.has(CITY_COOKIE)) {
    const { city } = geolocation(request);
    response.cookies.set(CITY_COOKIE, matchCityByGeoName(city), {
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });
  }

  return response;
}

export const config = {
  matcher: "/((?!_next/static|_next/image|favicon.ico).*)",
};
