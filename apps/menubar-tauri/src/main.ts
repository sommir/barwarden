import "zone.js";

import { bootstrapApplication } from "@angular/platform-browser";

import { AppComponent } from "./app/app.component";
import { appConfig } from "./app/app.config";
import { BARWARDEN_BRAND } from "./app/brand";
import { AppUpdateService } from "./app/updates/app-update.service";
import "./styles/global.css";
import { markWindowLayout } from "./window-layout-mode";

markWindowLayout(document.documentElement, window.location.search);

bootstrapApplication(AppComponent, appConfig)
  .then((application) => {
    void application.injector.get(AppUpdateService).checkInBackground();
  })
  .catch((error: unknown) => {
    console.error(`Failed to bootstrap ${BARWARDEN_BRAND.productName}`, error);
  });
