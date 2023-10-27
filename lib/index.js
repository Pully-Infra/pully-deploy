#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { Tags } from "aws-cdk-lib/core";
import { PullyServer, SharedResources } from "./deploy";

class PullyApp extends cdk.App {
  constructor() {
    super();
    const sharedResources = new SharedResources(this, "SharedResourcesStack");

    const pullyServer = new PullyServer(this, "PullyServerStack", {
      s3: sharedResources.s3,
      vpc: sharedResources.vpc,
      redis: sharedResources.redis,
      cluster: sharedResources.cluster,
    });

    Tags.of(sharedResources).add("Infrastructure", "Pully");
    Tags.of(pullyServer).add("Infrastructure", "Pully");
  }
}

new PullyApp().synth();
