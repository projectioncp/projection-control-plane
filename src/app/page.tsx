import { redirect } from "next/navigation";

/**
 * Root route — redirects to the execution dashboard.
 */
export default function Home() {
  redirect("/dashboard");
}
