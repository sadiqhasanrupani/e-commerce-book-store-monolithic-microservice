import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { Auth }    from '../auth/decorator/auth.decorator';
import { Role }    from '../auth/decorator/role.decorator';
import { AuthTypes } from '@app/contract/auth/enums/auth-types.enum';
import { RoleTypes } from '@app/contract/auth/enums/role-types.enum';

import { CreateInvoiceDto }     from '@app/contract/invoices/dtos/create-invoice.dto';
import { ListInvoicesQueryDto } from '@app/contract/invoices/dtos/list-invoices-query.dto';
import { InvoicesService }      from './providers/invoices.service';

@ApiTags('Invoices')
@ApiBearerAuth()
@Auth(AuthTypes.BEARER)
@Role(RoleTypes.ADMIN)
@Controller('invoices')
export class InvoicesController {
  constructor(private readonly invoicesService: InvoicesService) {}

  // ── POST /api/v1/invoices ─────────────────────────────────────────────────

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create a new invoice',
    description: `
Creates an invoice for an existing order.

**Business rule enforced at both DTO and service layers:**
If any item in \`items[]\` has \`itemType: TANGIBLE\`, the \`shippingAddress\`
object is mandatory. Digital-only (\`INTANGIBLE\`) invoices may omit it.

The invoice number is generated atomically (format \`INV-YYYYMMDD-XXXX\`)
and is guaranteed unique even under concurrent requests.
    `.trim(),
  })
  @ApiCreatedResponse({
    description: 'Invoice created in DRAFT status.',
    schema: {
      example: {
        message: 'Invoice INV-20240501-0001 created successfully.',
        data: {
          id: 'uuid',
          invoiceNumber: 'INV-20240501-0001',
          status: 'DRAFT',
          totalAmount: '1049.82',
          hasPhysicalItems: true,
          hasDigitalItems: false,
        },
      },
    },
  })
  async create(@Body() dto: CreateInvoiceDto) {
    const invoice = await this.invoicesService.create(dto);
    return {
      message: `Invoice ${invoice.invoiceNumber} created successfully.`,
      data: invoice,
    };
  }

  // ── GET /api/v1/invoices ──────────────────────────────────────────────────

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'List invoices',
    description: `
Returns a paginated list of invoices.

**Query parameters:**
- \`status\`     — filter by InvoiceStatus (DRAFT | ISSUED | PAID | OVERDUE | CANCELLED | REFUNDED)
- \`userId\`     — restrict to a specific buyer
- \`orderId\`    — restrict to a specific order
- \`sortBy\`     — one of \`createdAt\` | \`invoiceDate\` | \`totalAmount\` (default: \`createdAt\`)
- \`sortOrder\`  — \`ASC\` | \`DESC\` (default: \`DESC\`)
- \`page\` / \`limit\` — standard pagination (default: page 1, limit 10)
    `.trim(),
  })
  @ApiOkResponse({
    description: 'Paginated invoice list with metadata.',
    schema: {
      example: {
        message: 'Invoices retrieved successfully.',
        data: [],
        meta: {
          itemsPerPage: 10,
          totalItems: 42,
          currentPage: 1,
          totalPages: 5,
        },
      },
    },
  })
  findAll(@Query() query: ListInvoicesQueryDto) {
    return this.invoicesService.findAll(query);
  }
}
