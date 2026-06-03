import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Home from "./pages/Home";
import Tenants from "./pages/Tenants";
import TenantDetail from "./pages/TenantDetail";
import Agents from "./pages/Agents";
import Invoices from "./pages/Invoices";
import Receivables from "./pages/Receivables";
import Payables from "./pages/Payables";
import Customers from "./pages/Customers";
import Logs from "./pages/Logs";
import ModelConfigs from "./pages/ModelConfigs";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/tenants" component={Tenants} />
      <Route path="/tenants/:id" component={TenantDetail} />
      <Route path="/agents" component={Agents} />
      <Route path="/invoices" component={Invoices} />
      <Route path="/receivables" component={Receivables} />
      <Route path="/payables" component={Payables} />
      <Route path="/customers" component={Customers} />
      <Route path="/logs" component={Logs} />
      <Route path="/model-configs" component={ModelConfigs} />
      <Route path="/404" component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark">
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
