#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { PullyServer, SharedResources } from "./deploy";

class PullyApp extends cdk.App {
  constructor() {
    super();
    const sharedResources = new SharedResources(this, "SharedResourcesStack");

    const pullyServer = new PullyServer(this, "PullyServerStack", {
      s3: sharedResources.s3,
      cluster: sharedResources.cluster,
      vpc: sharedResources.vpc,
    });
  }
}

new PullyApp().synth();
