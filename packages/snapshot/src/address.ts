import { BlockList, isIP } from "node:net";

const blocked = new BlockList();

function block4(cidr: string, prefix: number): void {
  const [base] = cidr.split("/");
  blocked.addSubnet(base!, prefix, "ipv4");
}

function block6(cidr: string, prefix: number): void {
  const [base] = cidr.split("/");
  blocked.addSubnet(base!, prefix, "ipv6");
}

block4("0.0.0.0/8", 8);
block4("10.0.0.0/8", 8);
block4("100.64.0.0/10", 10);
block4("127.0.0.0/8", 8);
block4("169.254.0.0/16", 16);
block4("172.16.0.0/12", 12);
block4("192.0.0.0/24", 24);
block4("192.0.2.0/24", 24);
block4("192.168.0.0/16", 16);
block4("198.18.0.0/15", 15);
block4("198.51.100.0/24", 24);
block4("203.0.113.0/24", 24);
block4("224.0.0.0/4", 4);
block4("240.0.0.0/4", 4);
blocked.addAddress("255.255.255.255", "ipv4");

blocked.addAddress("::", "ipv6");
blocked.addAddress("::1", "ipv6");
block6("2001:db8::/32", 32);
block6("fc00::/7", 7);
block6("fe80::/10", 10);
block6("ff00::/8", 8);

/** True when the address must not be connected to. IPv4-mapped IPv6 is always refused. */
export function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return true;
  const lower = address.toLowerCase();
  if (lower.startsWith("::ffff:")) return true;
  if (family === 4) return blocked.check(address, "ipv4");
  return blocked.check(address, "ipv6");
}

export function assertPublicAddresses(addresses: readonly string[]): void {
  if (addresses.length === 0) {
    throw new Error("dns lookup returned no addresses");
  }
  for (const address of addresses) {
    if (isBlockedAddress(address)) {
      throw new Error("refusing non-public address");
    }
  }
}
