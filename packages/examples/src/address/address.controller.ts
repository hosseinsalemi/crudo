import { Controller } from "@nestjs/common";
import { Crud } from "@crudo/nest";
import { Address } from "./address.entity.js";
import { CreateAddressDto, UpdateAddressDto, AddressItemDto, AddressListDto } from "./address.dtos.js";

/**
 * Plain CRUD over `Address`. Owners associate an address by id
 * (`{"address": 1}` on `POST /owners` — ADR-0014); this route is how one
 * gets created in the first place.
 */
@Crud(Address, {
  dto: {
    create: CreateAddressDto,
    update: UpdateAddressDto,
    item: AddressItemDto,
    list: AddressListDto,
  },
})
@Controller("addresses")
export class AddressController {}
