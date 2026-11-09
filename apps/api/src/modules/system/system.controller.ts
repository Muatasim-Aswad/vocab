import { Controller } from "@nestjs/common";
import { routes } from "@vocab/contracts";

import { Contract } from "../../platform/http/contract.js";
import { SystemService } from "./system.service.js";

@Controller()
export class SystemController {
  constructor(private readonly system: SystemService) {}

  @Contract(routes.liveness)
  liveness() {
    return { status: "ok" };
  }

  @Contract(routes.readiness)
  readiness() {
    return this.system.readiness();
  }

  @Contract(routes.status)
  status() {
    return this.system.status();
  }
}
