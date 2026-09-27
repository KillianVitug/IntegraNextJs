import { NextRequest, NextResponse } from "next/server";

type RedirectParamValue = string | number | boolean | null | undefined;

const LOCAL_WILDCARD_HOSTS = new Set(["0.0.0.0", "::", "[::]"]);

function getRedirectOrigin(request: NextRequest) {
  const requestOrigin = request.nextUrl.origin;
  const requestHostname = request.nextUrl.hostname;
  const hostHeader = request.headers.get("host")?.trim();

  if (
    process.env.NODE_ENV === "development" &&
    hostHeader &&
    LOCAL_WILDCARD_HOSTS.has(requestHostname)
  ) {
    return `${request.nextUrl.protocol}//${hostHeader}`;
  }

  return requestOrigin;
}

export function buildRequestHostUrl(
  request: NextRequest,
  pathname: string,
  params?: Record<string, RedirectParamValue>,
) {
  const url = new URL(pathname, getRedirectOrigin(request));

  for (const [key, value] of Object.entries(params ?? {})) {
    if (value != null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }

  return url;
}

export function redirectToRequestHost(
  request: NextRequest,
  pathname: string,
  params?: Record<string, RedirectParamValue>,
  status = 303,
) {
  return NextResponse.redirect(buildRequestHostUrl(request, pathname, params), status);
}
