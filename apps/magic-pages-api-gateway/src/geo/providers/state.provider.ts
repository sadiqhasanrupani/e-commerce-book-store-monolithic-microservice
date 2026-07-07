import { Injectable } from "@nestjs/common";

@Injectable()
export class StateProvider {

  public async getStates(countryId: string) {
    return { state: "maharashtra" };
  }
}
