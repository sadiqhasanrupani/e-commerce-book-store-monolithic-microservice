import { Injectable } from "@nestjs/common";

@Injectable()
export class CountryProvider {

  public async getCountries() {
    return [
      { id: "uuid", code: "IN", name: "India", phoneCode: "+91" }
    ]
  }
}
