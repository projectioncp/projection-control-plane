import { DashboardClient } from "@/components/dashboard/DashboardClient";

/**
 * Execution Dashboard — server component shell.
 *
 * Renders the DashboardClient component which holds interactive state
 * (selected scenario, future live polling). The server component keeps
 * the route meta clean and allows for future server-side data fetching
 * when the runtime client is wired.
 */
export default function DashboardPage() {
  return <DashboardClient />;
}

export const metadata = {
  title: "Execution Dashboard · Projection Control Plane",
};
