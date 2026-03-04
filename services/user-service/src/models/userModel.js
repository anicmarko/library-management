const { DataTypes } = require('sequelize');

/**
 * Define User model
 * @param {import('sequelize').Sequelize} sequelize - Sequelize instance
 * @returns {import('sequelize').Model} User model
 */
function defineUserModel(sequelize) {
  const User = sequelize.define(
    'User',
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      name: {
        type: DataTypes.STRING(100),
        allowNull: false,
        validate: {
          notNull: {
            msg: 'Name is required',
          },
          notEmpty: {
            msg: 'Name cannot be empty',
          },
          len: {
            args: [2, 100],
            msg: 'Name must be between 2 and 100 characters',
          },
        },
      },
      email: {
        type: DataTypes.STRING(255),
        allowNull: false,
        unique: {
          msg: 'Email already exists',
        },
        validate: {
          notNull: {
            msg: 'Email is required',
          },
          notEmpty: {
            msg: 'Email cannot be empty',
          },
          isEmail: {
            msg: 'Invalid email format',
          },
        },
      },
      active: {
        type: DataTypes.BOOLEAN,
        defaultValue: true,
        allowNull: false,
      },
      loanCount: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
        allowNull: false,
        validate: {
          min: {
            args: [0],
            msg: 'Loan count cannot be negative',
          },
        },
      },
    },
    {
      tableName: 'users',
      timestamps: true,
      underscored: true,
      indexes: [
        {
          unique: true,
          fields: ['email'],
        },
        {
          fields: ['active'],
        },
      ],
    }
  );

  return User;
}

module.exports = { defineUserModel };
