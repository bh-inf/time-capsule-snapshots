export const CWA_FORECAST_URL =
  "https://opendata.cwa.gov.tw/api/v1/rest/datastore/F-C0032-001?format=JSON";
export const CWA_OBSERVATION_URL =
  "https://opendata.cwa.gov.tw/api/v1/rest/datastore/O-A0003-001?format=JSON";
export const TRENDS_TERMS_URL = "https://support.google.com/trends/answer/4365538?hl=en";

export const TRENDS_ATTRIBUTION =
  "Google Trends。依 Google 服務條款使用；再使用時請註明 Google。https://support.google.com/trends/answer/4365538?hl=en";

export const CWA_ATTRIBUTION = "中央氣象署開放資料（氣象資料開放平台）";

export type RegionProfile = {
  code: string;
  trendsGeo: string;
  timeZone: string;
};

export const TW: RegionProfile = {
  code: "TW",
  trendsGeo: "TW",
  timeZone: "Asia/Taipei",
};

export function trendsRssUrl(geo: string): string {
  const url = new URL("https://trends.google.com/trending/rss");
  url.searchParams.set("geo", geo);
  return url.toString();
}

/** Stored as a link only. robots.txt disallows fetching /trends/explore. */
export function trendsExploreUrl(term: string, geo: string): string {
  const url = new URL("https://trends.google.com/trends/explore");
  url.searchParams.set("q", term);
  url.searchParams.set("geo", geo);
  return url.toString();
}

export const COUNTY_CODES: Record<string, string> = {
  基隆市: "KEE",
  臺北市: "TPE",
  台北市: "TPE",
  新北市: "NWT",
  桃園市: "TAO",
  新竹市: "HSZ",
  新竹縣: "HSQ",
  苗栗縣: "MIA",
  臺中市: "TXG",
  台中市: "TXG",
  彰化縣: "CHA",
  南投縣: "NAN",
  雲林縣: "YUN",
  嘉義市: "CYI",
  嘉義縣: "CYQ",
  臺南市: "TNN",
  台南市: "TNN",
  高雄市: "KHH",
  屏東縣: "PIF",
  宜蘭縣: "ILA",
  花蓮縣: "HUA",
  臺東縣: "TTT",
  台東縣: "TTT",
  澎湖縣: "PEN",
  金門縣: "KIN",
  連江縣: "LIE",
};
