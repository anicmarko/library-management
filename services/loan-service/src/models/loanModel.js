const { DataTypes } = require('sequelize');

const defineLoanModel = (sequelize) => {
  const Loan = sequelize.define('Loan', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    bookId: {
      type: DataTypes.STRING,
      allowNull: false,
      field: 'book_id',
      validate: {
        notNull: {
          msg: 'Book ID is required'
        }
      }
    },
    userId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: 'user_id',
      validate: {
        notNull: {
          msg: 'User ID is required'
        },
        isInt: {
          msg: 'User ID must be an integer'
        }
      }
    },
    loanDate: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
      field: 'loan_date'
    },
    dueDate: {
      type: DataTypes.DATE,
      allowNull: false,
      field: 'due_date',
      validate: {
        notNull: {
          msg: 'Due date is required'
        },
        isDate: {
          msg: 'Due date must be a valid date'
        }
      }
    },
    returnedAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: 'returned_at'
    },
    status: {
      type: DataTypes.ENUM('active', 'returned'),
      allowNull: false,
      defaultValue: 'active',
      validate: {
        isIn: {
          args: [['active', 'returned']],
          msg: 'Status must be either active or returned'
        }
      }
    }
  }, {
    tableName: 'loans',
    timestamps: true,
    underscored: true,
    indexes: [
      {
        fields: ['status']
      }
    ]
  });

  return Loan;
};

module.exports = defineLoanModel;
