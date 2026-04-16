import { lazy, Suspense } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AppLayout } from "@/components/AppLayout";
import { Loader2 } from "lucide-react";

// Eager-loaded (auth flow)
import Login from "./pages/Login";
import Signup from "./pages/Signup";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";

// Lazy-loaded pages
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Workers = lazy(() => import("./pages/Workers"));
const WorkerForm = lazy(() => import("./pages/WorkerForm"));
const WorkerDetail = lazy(() => import("./pages/WorkerDetail"));
const Events = lazy(() => import("./pages/Events"));
const EventForm = lazy(() => import("./pages/EventForm"));
const EventDetail = lazy(() => import("./pages/EventDetail"));
const Companies = lazy(() => import("./pages/Companies"));
const CompanyForm = lazy(() => import("./pages/CompanyForm"));
const CompanyDetail = lazy(() => import("./pages/CompanyDetail"));
const Links = lazy(() => import("./pages/Links"));
const LinkDetail = lazy(() => import("./pages/LinkDetail"));
const LinkForm = lazy(() => import("./pages/LinkForm"));
const LinkWorkerDetail = lazy(() => import("./pages/LinkWorkerDetail"));
const Payroll = lazy(() => import("./pages/Payroll"));
const PayrollForm = lazy(() => import("./pages/PayrollForm"));
const PayrollDetail = lazy(() => import("./pages/PayrollDetail"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));
const NotFound = lazy(() => import("./pages/NotFound"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 2 * 60 * 1000, // 2 min — avoid refetch on every navigation
      gcTime: 5 * 60 * 1000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

function PageLoader() {
  return (
    <div className="flex justify-center py-12">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Suspense fallback={<PageLoader />}>
            <Routes>
              {/* Public routes */}
              <Route path="/login" element={<Login />} />
              <Route path="/signup" element={<Signup />} />
              <Route path="/forgot-password" element={<ForgotPassword />} />
              <Route path="/reset-password" element={<ResetPassword />} />

              {/* Protected routes with layout */}
              <Route path="/dashboard" element={<Navigate to="/" replace />} />

              {/* Protected routes with layout */}
              <Route element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
                <Route path="/" element={<Dashboard />} />
                <Route path="/workers" element={<Workers />} />
                <Route path="/workers/new" element={<WorkerForm key="new" />} />
                <Route path="/workers/:id" element={<WorkerDetail />} />
                <Route path="/workers/:id/edit" element={<WorkerForm key="edit" />} />
                <Route path="/events" element={<Events />} />
                <Route path="/events/new" element={<EventForm />} />
                <Route path="/events/:id" element={<EventDetail />} />
                <Route path="/events/:id/edit" element={<EventForm />} />
                <Route path="/companies" element={<Companies />} />
                <Route path="/companies/new" element={<CompanyForm />} />
                <Route path="/companies/:id" element={<CompanyDetail />} />
                <Route path="/companies/:id/edit" element={<CompanyForm />} />
                <Route path="/links" element={<Links />} />
                <Route path="/links/new" element={<LinkForm key="new" />} />
                <Route path="/links/:id" element={<LinkDetail />} />
                <Route path="/links/:groupId/workers/:workerId" element={<LinkWorkerDetail />} />
                <Route path="/links/:id/edit" element={<LinkForm key="edit" />} />
                <Route path="/payroll" element={<Payroll />} />
                <Route path="/payroll/new" element={<PayrollForm />} />
                <Route path="/payroll/:id" element={<PayrollDetail />} />
                <Route path="/payroll/:id/edit" element={<PayrollForm />} />
                <Route path="/settings" element={<ProtectedRoute requiredRoles={["admin", "manager"]}><SettingsPage /></ProtectedRoute>} />
              </Route>

              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
